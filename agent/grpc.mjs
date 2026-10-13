import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';

export const GRPC_PROTO_LIMIT = 128 * 1024;
export const GRPC_MESSAGE_LIMIT = 2 * 1024 * 1024;
const DEADLINE_MS = 25000;
const RESERVED_METADATA = /^(grpc-|:|te$|content-type$|connection$|host$|user-agent$)/i;
const META_KEY = /^[a-z0-9_.-]+$/;

export function validateGrpcTarget(raw, allowedHosts, agentPort) {
  if (typeof raw !== 'string') throw Error('gRPC target is required.');
  const url = new URL(raw);
  if (!['grpc:', 'grpcs:'].includes(url.protocol) || !url.hostname ||
      url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '') ||
      !/^\d+$/.test(url.port)) {
    throw Error('Use grpc://host:port (plaintext) or grpcs://host:port (TLS).');
  }
  const port = Number(url.port);
  if (port < 1 || port > 65535) throw Error('Invalid gRPC port.');
  if (!allowedHosts.has(url.hostname.toLowerCase())) throw Error('gRPC host is not in the Agent allowlist.');
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) && port === agentPort) {
    throw Error('gRPC cannot connect to the Agent itself.');
  }
  return { host: url.hostname, port, tls: url.protocol === 'grpcs:' };
}

export function resolveUnaryMethod(protoText, serviceName, methodName) {
  if (typeof protoText !== 'string' || Buffer.byteLength(protoText, 'utf8') > GRPC_PROTO_LIMIT) {
    throw Error('Inline .proto must be at most 128 KiB.');
  }
  if (!protoText.trim()) throw Error('Upload or paste a .proto definition.');
  if (typeof serviceName !== 'string' || !/^[\w.]{1,200}$/.test(serviceName) ||
      typeof methodName !== 'string' || !/^[A-Za-z_]\w{0,127}$/.test(methodName)) {
    throw Error('Enter a valid fully qualified service name and RPC method.');
  }
  const parsed = protobuf.parse(protoText, { keepCase: true });
  // Untrusted client input never causes filesystem or remote proto imports.
  if ((parsed.imports || []).length || (parsed.weakImports || []).length) throw Error('Imported .proto files are not supported in this version. Use a self-contained definition.');
  const root = parsed.root;
  root.resolveAll();
  const service = root.lookupService(serviceName);
  const method = service.methods[methodName];
  if (!method) throw Error('Method does not exist in this service.');
  if (method.requestStream || method.responseStream) throw Error('Only unary gRPC methods are supported.');
  return { root, method, path: '/' + service.fullName.slice(1) + '/' + method.name,
    requestType: root.lookupType(method.requestType), responseType: root.lookupType(method.responseType) };
}

function metadataFromObject(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 40) {
    throw Error('Metadata must be a JSON object with at most 40 entries.');
  }
  const metadata = new grpc.Metadata();
  for (const [key, value] of Object.entries(values)) {
    if (!META_KEY.test(key) || RESERVED_METADATA.test(key) || key.endsWith('-bin') ||
        typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value)) {
      throw Error('Invalid metadata key/value: ' + key);
    }
    metadata.set(key, value);
  }
  return metadata;
}

export async function callGrpcUnary(payload, { allowedHosts, agentPort, timeoutMs = DEADLINE_MS } = {}) {
  if (!payload || typeof payload !== 'object') throw Error('Invalid gRPC payload.');
  const target = validateGrpcTarget(payload.target, allowedHosts, agentPort);
  const { requestType, responseType, path } = resolveUnaryMethod(payload.proto, payload.service, payload.method);
  const input = payload.message ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('gRPC message must be a JSON object.');
  const message = requestType.fromObject(input);
  const verify = requestType.verify(message);
  if (verify) throw Error('Invalid gRPC input: ' + verify);
  const encoded = requestType.encode(message).finish();
  if (encoded.length > GRPC_MESSAGE_LIMIT) throw Error('gRPC request exceeds 2 MiB.');
  const metadata = metadataFromObject(payload.metadata ?? {});
  const credentials = target.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
  const address = target.host + ':' + target.port;
  const client = new grpc.Client(address, credentials, {
    'grpc.max_receive_message_length': GRPC_MESSAGE_LIMIT,
    'grpc.max_send_message_length': GRPC_MESSAGE_LIMIT,
    'grpc.enable_retries': 0,
  });
  const started = performance.now();
  try {
    return await new Promise((resolve, reject) => {
      let timer;
      const complete = (error, value) => {
        clearTimeout(timer);
        if (error) {
          const code = Number.isInteger(error.code) ? error.code : grpc.status.UNKNOWN;
          reject(Error('gRPC ' + grpc.status[code] + ' (' + code + '): ' + (error.details || error.message)));
          return;
        }
        const result = responseType.toObject(value, { longs: String, enums: String, bytes: String, defaults: true });
        const json = JSON.stringify(result);
        if (Buffer.byteLength(json, 'utf8') > GRPC_MESSAGE_LIMIT) reject(Error('gRPC response exceeds 2 MiB.'));
        else resolve({ response: result, duration: Math.round(performance.now() - started), status: 0, statusText: 'OK' });
      };
      const call = client.makeUnaryRequest(path, arg => Buffer.from(encoded), bytes => responseType.decode(bytes), input, metadata,
        { deadline: Date.now() + timeoutMs }, complete);
      timer = setTimeout(() => call.cancel(), timeoutMs + 1000);
    });
  } finally {
    client.close();
  }
}
