import * as grpc from '@grpc/grpc-js';
import { randomUUID } from 'node:crypto';
import { validateGrpcTarget, resolveUnaryMethod, metadataFromObject, GRPC_MESSAGE_LIMIT } from './grpc.mjs';
import { getGrpcReflectionRoot } from './grpc-reflection.mjs';

const MAX_MESSAGES = 100;
const MAX_TOTAL = 2 * 1024 * 1024;
const DEADLINE_MS = 25000;
const SESSION_TTL_MS = 40000;

/**
 * Ephemeral gRPC client-/bidirectional-stream session.
 * Authentication, Origin checking and host allowlisting are performed by
 * the loopback Agent before calling this module. No session ID is a token.
 */
export async function createGrpcInteractiveSession(payload, options = {}, onExpire = () => {}) {
  if (!payload || typeof payload !== 'object') throw Error('Invalid gRPC session payload.');
  const { allowedHosts, agentPort, timeoutMs = DEADLINE_MS } = options;
  const target = validateGrpcTarget(payload.target, allowedHosts, agentPort);
  const root = payload.useReflection === true
    ? await getGrpcReflectionRoot(payload, { allowedHosts, agentPort, metadataFactory: metadataFromObject })
    : undefined;
  const { requestType, responseType, path, method } = resolveUnaryMethod(
    root ? '' : payload.proto, payload.service, payload.method,
    payload.protoFiles || [], payload.entryName || 'main.proto', root, 'interactive',
  );
  if (!method.requestStream) throw Error('Selected RPC is not client-streaming or bidirectional-streaming.');
  const metadata = metadataFromObject(payload.metadata || {});
  const client = new grpc.Client(target.host + ':' + target.port,
    target.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(), {
      'grpc.max_receive_message_length': GRPC_MESSAGE_LIMIT,
      'grpc.max_send_message_length': GRPC_MESSAGE_LIMIT,
      'grpc.enable_retries': 0,
    });
  const id = randomUUID(), mode = method.responseStream ? 'bidi' : 'client-stream';
  let call, closed = false, halfClosed = false, observer = null;
  let outputCount = 0, outputBytes = 0, inputCount = 0, inputBytes = 0;
  const events = [];
  const started = performance.now();
  let deadlineTimer, ttlTimer;

  function emit(event) {
    if (closed) return;
    const record = { ...event };
    if (event.type === 'message') {
      const size = Buffer.byteLength(JSON.stringify(event.data), 'utf8');
      outputCount++;
      outputBytes += size;
      if (outputCount > MAX_MESSAGES || outputBytes > MAX_TOTAL) {
        finish({ type:'error', error:'Response exceeded 100 messages or 2 MiB preview.' });
        return;
      }
      record.index = outputCount;
    }
    if (record.type === 'complete' || record.type === 'error') {
      record.count = outputCount;
      record.duration = Math.round(performance.now() - started);
      closed = true;
      clearTimeout(deadlineTimer);
    }
    events.push(record);
    if (observer && !observer.destroyed && !observer.writableEnded) {
      if (!observer.write(JSON.stringify(record) + '\n')) {
        // A slow subscriber cannot accumulate unbounded data in the agent.
        if (!closed) finish({ type:'error', error:'Response consumer is too slow.' });
        else observer.end();
        return;
      }
      if (closed) observer.end();
    }
    if (closed) {
      call?.cancel();
      client.close();
    }
  }
  function finish(event) { emit(event); }
  function acceptResponse(value) {
    try {
      const data = responseType.toObject(value, { longs:String, enums:String, bytes:String, defaults:true });
      emit({ type:'message', data });
    } catch (error) { finish({type:'error', error:error instanceof Error ? error.message : 'Invalid gRPC response.'}); }
  }
  try {
    if (mode === 'client-stream') {
      call = client.makeClientStreamRequest(path,
        input => Buffer.from(requestType.encode(input).finish()),
        bytes => responseType.decode(bytes), metadata,
        { deadline:Date.now() + timeoutMs }, (error, result) => {
          if (closed) return;
          if (error) finish({type:'error', error:'gRPC ' + (grpc.status[error.code] || 'UNKNOWN') + ': ' + (error.details || error.message)});
          else { acceptResponse(result); if (!closed) finish({type:'complete',status:0,statusText:'OK'}); }
        });
    } else {
      call = client.makeBidiStreamRequest(path,
        input => Buffer.from(requestType.encode(input).finish()),
        bytes => responseType.decode(bytes), metadata,
        { deadline:Date.now() + timeoutMs });
      call.on('data', acceptResponse);
      call.on('error', error => {
        if (!closed) finish({type:'error',error:'gRPC ' + (grpc.status[error.code] || 'UNKNOWN') + ': ' + (error.details || error.message)});
      });
      call.on('end', () => { if (!closed) finish({type:'complete',status:0,statusText:'OK'}); });
    }
    deadlineTimer = setTimeout(() => {
      if (!closed) finish({type:'error',error:'gRPC session deadline exceeded.'});
    }, timeoutMs + 500);
    // Idle completed sessions are removed whether or not a client subscribes.
    ttlTimer = setTimeout(() => {
      if (!closed) finish({type:'error',error:'gRPC session expired.'});
      if (observer && !observer.writableEnded) observer.end();
      onExpire(id);
    }, Math.max(timeoutMs + 3000, SESSION_TTL_MS));
    ttlTimer.unref?.();
  } catch (error) { client.close(); throw error; }

  return {
    id, mode,
    get closed() { return closed; },
    get halfClosed() { return halfClosed; },
    get inputCount() { return inputCount; },
    send(input) {
      if (closed || halfClosed) throw Error('gRPC stream has already ended or been half-closed.');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Message must be a JSON object.');
      const value = requestType.fromObject(input);
      const validation = requestType.verify(value);
      if (validation) throw Error('Invalid input: ' + validation);
      const size = requestType.encode(value).finish().byteLength;
      if (size > GRPC_MESSAGE_LIMIT || inputCount >= MAX_MESSAGES || inputBytes + size > MAX_TOTAL) {
        throw Error('Client stream exceeds 100 messages or 2 MiB total.');
      }
      inputCount++; inputBytes += size;
      call.write(value);
      return inputCount;
    },
    halfClose() {
      if (closed || halfClosed) throw Error('gRPC stream has already ended or been half-closed.');
      halfClosed = true;
      call.end();
    },
    cancel() {
      if (!closed) finish({type:'error',error:'gRPC session cancelled.'});
    },
    subscribe(res) {
      if (observer && observer !== res && !observer.writableEnded) throw Error('A subscriber is already connected.');
      observer = res;
      res.on('close', () => {
        if (observer === res) {
          observer = null;
          if (!closed) this.cancel();
        }
      });
      for (const event of events) {
        if (res.destroyed || res.writableEnded) break;
        if (!res.write(JSON.stringify(event) + '\n')) {
          if (!closed) this.cancel();
          break;
        }
      }
      if (closed && !res.writableEnded) res.end();
    },
    dispose() {
      clearTimeout(deadlineTimer); clearTimeout(ttlTimer);
      if (!closed) this.cancel();
      if (observer && !observer.writableEnded) observer.end();
      onExpire(id);
    },
  };
}
