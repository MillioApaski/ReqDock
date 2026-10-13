import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';
import descriptor from 'protobufjs/ext/descriptor.js';
import { validateGrpcTarget } from './grpc.mjs';

export const REFLECTION_PROTO = [
  'syntax = "proto3"; package grpc.reflection.v1;',
  'message ServerReflectionRequest { string host = 1; oneof message_request { string file_containing_symbol = 4; string list_services = 7; } }',
  'message FileDescriptorResponse { repeated bytes file_descriptor_proto = 1; }',
  'message ServiceResponse { string name = 1; }',
  'message ListServiceResponse { repeated ServiceResponse service = 1; }',
  'message ErrorResponse { int32 error_code = 1; string error_message = 2; }',
  'message ServerReflectionResponse { string valid_host = 1; ServerReflectionRequest original_request = 2;',
  ' oneof message_response { FileDescriptorResponse file_descriptor_response = 4; ListServiceResponse list_services_response = 6; ErrorResponse error_response = 7; } }',
].join('\n');
const ROOT = protobuf.parse(REFLECTION_PROTO, { keepCase: true }).root;
const REQUEST = ROOT.lookupType('grpc.reflection.v1.ServerReflectionRequest');
const RESPONSE = ROOT.lookupType('grpc.reflection.v1.ServerReflectionResponse');
const MAX_DESCRIPTOR_BYTES = 1024 * 1024;
const REFLECTION_TIMEOUT = 8000;

export async function queryGrpcReflection(target, request, metadata, timeoutMs = REFLECTION_TIMEOUT) {
  const creds = target.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
  const client = new grpc.Client(target.host + ':' + target.port, creds, {
    'grpc.max_receive_message_length': MAX_DESCRIPTOR_BYTES,
    'grpc.enable_retries': 0,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.close();
      if (error) reject(error);
      else resolve(result);
    };
    const call = client.makeBidiStreamRequest(
      '/grpc.reflection.v1.ServerReflection/ServerReflectionInfo',
      input => Buffer.from(REQUEST.encode(REQUEST.fromObject(input)).finish()),
      bytes => RESPONSE.toObject(RESPONSE.decode(bytes), { bytes: Buffer }),
      metadata,
    );
    const timer = setTimeout(() => { call.cancel(); finish(Error('gRPC reflection timed out.')); }, timeoutMs);
    call.on('data', response => {
      if (response.error_response) {
        return finish(Error('Reflection error ' + response.error_response.error_code + ': ' + response.error_response.error_message));
      }
      finish(null, response);
    });
    call.on('error', error => finish(Error('gRPC reflection unavailable: ' + (error.details || error.message))));
    call.on('end', () => finish(Error('Reflection stream ended without a response.')));
    call.write(request);
    call.end();
  });
}

export function reflectionRootFromResponse(result) {
  const blobs = result?.file_descriptor_response?.file_descriptor_proto;
  if (!Array.isArray(blobs) || !blobs.length || blobs.length > 64) {
    throw Error('Reflection did not return valid file descriptors.');
  }
  let total = 0;
  const files = [];
  const seen = new Set();
  for (const blob of blobs) {
    const data = Buffer.from(blob);
    total += data.byteLength;
    if (total > MAX_DESCRIPTOR_BYTES) throw Error('Reflection descriptors exceed 1 MiB.');
    const file = descriptor.FileDescriptorProto.decode(data);
    if (!file.name || seen.has(file.name)) continue;
    seen.add(file.name);
    files.push(file);
  }
  if (!files.length) throw Error('No usable reflection descriptors.');
  const set = descriptor.FileDescriptorSet.create({ file: files });
  const root = protobuf.Root.fromDescriptor(set);
  root.resolveAll();
  return root;
}

export async function discoverGrpc(payload, { allowedHosts, agentPort, metadataFactory }) {
  if (!payload || typeof payload !== 'object') throw Error('Invalid reflection request.');
  const target = validateGrpcTarget(payload.target, allowedHosts, agentPort);
  const metadata = metadataFactory(payload.metadata || {});
  if (!payload.service) {
    const res = await queryGrpcReflection(target, { list_services: '' }, metadata);
    const services = res.list_services_response?.service?.map(item => item.name)
      .filter(name => typeof name === 'string' && name.length <= 200) || [];
    return { services: services.slice(0, 250) };
  }
  if (typeof payload.service !== 'string' || !/^[\w.]{1,200}$/.test(payload.service)) throw Error('Invalid service.');
  const res = await queryGrpcReflection(target, { file_containing_symbol: payload.service }, metadata);
  const root = reflectionRootFromResponse(res);
  const service = root.lookupService(payload.service);
  return { services: [payload.service], methods: Object.values(service.methods).map(method => ({
    name: method.name, requestStream: Boolean(method.requestStream), responseStream: Boolean(method.responseStream),
  })) };
}

export async function getGrpcReflectionRoot(payload, { allowedHosts, agentPort, metadataFactory }) {
  const target = validateGrpcTarget(payload.target, allowedHosts, agentPort);
  const metadata = metadataFactory(payload.metadata || {});
  if (typeof payload.service !== 'string' || !/^[\w.]{1,200}$/.test(payload.service)) throw Error('Invalid gRPC service.');
  const res = await queryGrpcReflection(target, { file_containing_symbol: payload.service }, metadata);
  return reflectionRootFromResponse(res);
}
