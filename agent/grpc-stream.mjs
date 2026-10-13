import * as grpc from '@grpc/grpc-js';
import { validateGrpcTarget, resolveUnaryMethod, metadataFromObject, GRPC_MESSAGE_LIMIT } from './grpc.mjs';
import { getGrpcReflectionRoot } from './grpc-reflection.mjs';

export const STREAM_MESSAGE_LIMIT = 100;
export const STREAM_TOTAL_LIMIT = 2 * 1024 * 1024;
const DEADLINE_MS = 25000;

/**
 * Server-side gRPC streaming only (one request, several responses).
 * The callback is synchronous: returning false signals stalled HTTP backpressure.
 * The abort signal comes from the browser HTTP response closing.
 */
export async function streamGrpcServer(payload, { allowedHosts, agentPort, timeoutMs = DEADLINE_MS } = {}, onEvent, signal) {
  if (!payload || typeof payload !== 'object') throw Error('Invalid gRPC stream payload.');
  if (typeof onEvent !== 'function') throw Error('Missing stream event sink.');
  if (signal?.aborted) return;
  const target = validateGrpcTarget(payload.target, allowedHosts, agentPort);
  const reflectionRoot = payload.useReflection === true
    ? await getGrpcReflectionRoot(payload, { allowedHosts, agentPort, metadataFactory: metadataFromObject }) : undefined;
  if (signal?.aborted) return;
  const { requestType, responseType, path, method } = resolveUnaryMethod(
    reflectionRoot ? '' : payload.proto, payload.service, payload.method,
    payload.protoFiles || [], payload.entryName || 'main.proto', reflectionRoot, 'server-stream',
  );
  if (method.requestStream || !method.responseStream) throw Error('Selected method is not a server-streaming RPC.');
  const input = payload.message ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('gRPC request must be a JSON object.');
  const requestMessage = requestType.fromObject(input);
  const verify = requestType.verify(requestMessage);
  if (verify) throw Error('Invalid gRPC input: ' + verify);
  const requestBytes = requestType.encode(requestMessage).finish();
  if (requestBytes.length > GRPC_MESSAGE_LIMIT) throw Error('gRPC request exceeds 2 MiB.');
  const metadata = metadataFromObject(payload.metadata ?? {});
  const credentials = target.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
  const client = new grpc.Client(target.host + ':' + target.port, credentials, {
    'grpc.max_receive_message_length': GRPC_MESSAGE_LIMIT,
    'grpc.max_send_message_length': GRPC_MESSAGE_LIMIT,
    'grpc.enable_retries': 0,
  });
  const started = performance.now();
  try {
    await new Promise(resolve => {
      let done = false, count = 0, bytes = 0, call;
      const finish = event => {
        if (done) return;
        done = true;
        if (event && !signal?.aborted) onEvent({ ...event, count, duration: Math.round(performance.now() - started) });
        signal?.removeEventListener('abort', aborted);
        call?.cancel();
        resolve();
      };
      const aborted = () => finish(null);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) { finish(null); return; }
      try {
        call = client.makeServerStreamRequest(path,
          () => Buffer.from(requestBytes),
          buffer => responseType.decode(buffer),
          requestMessage, metadata, { deadline: Date.now() + timeoutMs });
        call.on('data', message => {
          if (done) return;
          try {
            const value = responseType.toObject(message, { longs: String, enums: String, bytes: String, defaults: true });
            const length = Buffer.byteLength(JSON.stringify(value), 'utf8');
            if (++count > STREAM_MESSAGE_LIMIT || (bytes += length) > STREAM_TOTAL_LIMIT) {
              finish({ type: 'error', error: 'Stream exceeded 100 messages or 2 MiB total preview limit.' }); return;
            }
            if (onEvent({ type:'message', index:count, data:value }) === false)
              finish({ type:'error', error:'Browser is not consuming stream data fast enough.' });
          } catch (error) { finish({ type:'error', error: error instanceof Error ? error.message : 'Invalid response message.' }); }
        });
        call.on('end', () => finish({ type:'complete', status:0, statusText:'OK' }));
        call.on('error', error => {
          if (!done) finish({ type:'error', error:'gRPC ' + (grpc.status[error.code] || 'UNKNOWN') + ': ' + (error.details || error.message) });
        });
      } catch (error) { finish({ type:'error', error:error instanceof Error ? error.message : 'Failed to start stream.' }); }
    });
  } finally { client.close(); }
}
