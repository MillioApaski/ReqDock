import type { Environment, GrpcRequestPreset } from '../types';
import { interpolate, LOCAL_AGENT_URL } from './request';
import { consumeGrpcStream, type GrpcStreamEvent } from './grpc-stream';

export type GrpcRunResult = {
  requestId: string; name: string; mode: GrpcRequestPreset['callMode'];
  status?: number; duration?: number; messageCount: number; error?: string;
};

type InvokeOptions = {
  endpoint?: string;
  onProgress?: (results: GrpcRunResult[]) => void;
};
const MAX_INPUT_MESSAGES = 100;
const AGENT_HEADERS = (token: string) => ({
  'Content-Type': 'application/json', 'X-ReqDock-Agent-Token': token,
});

function decodeJson(value: string, label: string): Record<string, unknown> {
  const object: unknown = JSON.parse(value);
  if (!object || typeof object !== 'object' || Array.isArray(object))
    throw Error(label + ' must be a JSON object.');
  return object as Record<string, unknown>;
}

function messagesFor(preset: GrpcRequestPreset, environment?: Environment): Record<string, unknown>[] {
  const input: unknown = JSON.parse(interpolate(preset.message, environment));
  if (preset.callMode !== 'client-stream' && preset.callMode !== 'bidi') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Request body must be a JSON object.');
    return [input as Record<string, unknown>];
  }
  const batch = Array.isArray(input) ? input : [input];
  if (batch.length > MAX_INPUT_MESSAGES) throw Error('Runner supports at most 100 client-stream messages.');
  if (batch.some(item => !item || typeof item !== 'object' || Array.isArray(item)))
    throw Error('Stream messages must be a JSON object or an array of objects.');
  return batch as Record<string, unknown>[];
}

function payloadFor(preset: GrpcRequestPreset, environment?: Environment) {
  const target = interpolate(preset.target, environment);
  const metadata = decodeJson(interpolate(preset.metadata || '{}', environment), 'Metadata');
  return {
    target, metadata, service: preset.service, method: preset.method,
    proto: preset.source === 'files' ? preset.proto : undefined,
    protoFiles: preset.source === 'files' ? preset.protoFiles : undefined,
    entryName: preset.source === 'files' ? preset.entryName : undefined,
    useReflection: preset.source === 'reflection',
  };
}

async function agentJson(url: string, token: string, signal: AbortSignal, payload?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST', headers: AGENT_HEADERS(token), cache: 'no-store', signal,
    body: JSON.stringify(payload ?? {}),
  });
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw Error('Local Agent returned invalid JSON.');
  const object = data as Record<string, unknown>;
  if (!response.ok) throw Error(typeof object.error === 'string' ? object.error : 'Local Agent error (' + response.status + ')');
  return object;
}

async function collectEvents(stream: ReadableStream<Uint8Array>, signal: AbortSignal) {
  let messages = 0, duration = 0, terminal: GrpcStreamEvent | null = null;
  if (signal.aborted) throw Error('Cancelled');
  await consumeGrpcStream(stream, event => {
    if (event.type === 'message') messages++;
    else if (event.type === 'error') terminal = event;
    else { duration = event.duration; terminal = event; }
  });
  if (signal.aborted) throw Error('Cancelled');
  if (!terminal) throw Error('gRPC stream ended unexpectedly.');
  if ((terminal as GrpcStreamEvent).type === 'error') throw Error((terminal as Extract<GrpcStreamEvent, {type:'error'}>).error);
  return { messageCount: messages, duration, status: 0 };
}

/**
 * A collection run intentionally uses one Local Agent transport and a fixed
 * sequence of saved RPC definitions. Interactive RPCs automatically send the
 * saved JSON object (or array of objects) and then half-close.
 *
 * No body/metadata values or pairing tokens are placed in run reports.
 */
export async function runGrpcCollection(
  presets: GrpcRequestPreset[], environment: Environment | undefined,
  agentToken: string, signal: AbortSignal, options: InvokeOptions = {},
): Promise<GrpcRunResult[]> {
  const endpoint = options.endpoint || LOCAL_AGENT_URL;
  const results: GrpcRunResult[] = [];
  for (const preset of presets) {
    if (signal.aborted) break;
    const current: GrpcRunResult = {
      requestId:preset.id, name:preset.name, mode:preset.callMode, messageCount:0,
    };
    const started = performance.now();
    let sessionId: string | null = null;
    try {
      if (!agentToken) throw Error('Local Agent is not paired. Enter its token before running gRPC requests.');
      const messages = messagesFor(preset, environment);
      const payload = payloadFor(preset, environment);
      if (preset.callMode === 'unary') {
        const data = await agentJson(endpoint + '/grpc/unary', agentToken, signal, {...payload, message:messages[0]});
        if (typeof data.status !== 'number' || data.status !== 0) throw Error('Unary RPC returned an invalid status.');
        current.status = data.status;
        current.duration = typeof data.duration === 'number' ? data.duration : Math.round(performance.now() - started);
        current.messageCount = 1;
      } else if (preset.callMode === 'server-stream') {
        const response = await fetch(endpoint + '/grpc/stream', {
          method:'POST', signal, headers:AGENT_HEADERS(agentToken),
          body:JSON.stringify({...payload,message:messages[0]}), cache:'no-store',
        });
        if (!response.ok) {
          const error = await response.json() as {error?: string};
          throw Error(error.error || 'Unable to start server streaming (' + response.status + ')');
        }
        if (!response.body) throw Error('Local Agent returned no gRPC stream.');
        Object.assign(current, await collectEvents(response.body, signal));
      } else {
        const created = await agentJson(endpoint + '/grpc/session', agentToken, signal, payload);
        if (typeof created.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(created.id))
          throw Error('Local Agent returned an invalid stream session.');
        sessionId = created.id;
        const base = endpoint + '/grpc/session/' + sessionId;
        // Start event subscription before sending. Do not await fetch headers
        // here: Node.js may not flush them until the first gRPC response.
        const eventsPromise = fetch(base + '/events', {
          headers: {'X-ReqDock-Agent-Token':agentToken}, signal, cache:'no-store',
        });
        // Attach a rejection handler immediately: the server could reject the
        // subscription before the first queued message is submitted.
        void eventsPromise.catch(() => {});
        try {
          for (const message of messages) {
            if (signal.aborted) throw Error('Cancelled');
            await agentJson(base + '/message', agentToken, signal, { message });
          }
          await agentJson(base + '/finish', agentToken, signal);
          const response = await eventsPromise;
          if (!response.ok || !response.body) throw Error('Cannot subscribe to Local Agent gRPC events.');
          Object.assign(current, await collectEvents(response.body, signal));
        } finally {
          // Always account for early subscription rejection to avoid unhandled
          // promise rejection after an aborted or failed write.
          void eventsPromise.catch(() => {});
        }
      }
    } catch (cause) {
      if (signal.aborted) break;
      current.error = cause instanceof Error ? cause.message : 'gRPC request failed.';
      current.duration = Math.round(performance.now() - started);
    } finally {
      if (sessionId) {
        // Cancels stalled or abandoned sessions. Never hold the runner open
        // merely to wait for cleanup after a timeout or explicit cancellation.
        void fetch(endpoint + '/grpc/session/' + sessionId + '/cancel', {
          method:'POST', headers:AGENT_HEADERS(agentToken),
          body:'{}', cache:'no-store',
        }).catch(() => {});
      }
    }
    results.push(current);
    options.onProgress?.([...results]);
  }
  return results;
}
