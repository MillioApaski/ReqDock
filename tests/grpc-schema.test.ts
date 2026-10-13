import { afterEach, describe, expect, it } from 'vitest';
import protobuf from 'protobufjs';
import descriptor from 'protobufjs/ext/descriptor.js';
import * as grpc from '@grpc/grpc-js';
import { createAgent } from '../agent/reqdock-agent.mjs';
import { parseProtoFiles } from '../agent/grpc-schema.mjs';
import { resolveUnaryMethod, callGrpcUnary } from '../agent/grpc.mjs';
import { REFLECTION_PROTO, discoverGrpc } from '../agent/grpc-reflection.mjs';

const MESSAGE = 'syntax = "proto3"; package sample; message HelloRequest { string name = 1; } message HelloReply { string message = 1; }';
const SERVICE = 'syntax = "proto3"; package sample; import "models/message.proto"; service Greeter { rpc Hello (HelloRequest) returns (HelloReply); }';
const ROOT_SOURCE = 'syntax = "proto3"; package sample; service Greeter { rpc Hello (HelloRequest) returns (HelloReply); } message HelloRequest { string name = 1; } message HelloReply { string message = 1; }';
const instances = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) {
    if (instance.agent) await new Promise(resolve => instance.agent.close(resolve));
    if (instance.grpcServer) instance.grpcServer.forceShutdown();
  }
});
const listen = server => new Promise((resolve, reject) =>
  server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => err ? reject(err) : resolve(port)));
async function startReflectingServer() {
  const root = protobuf.parse(ROOT_SOURCE).root;
  const req = root.lookupType('sample.HelloRequest');
  const rep = root.lookupType('sample.HelloReply');
  const definition = { Hello: {
    path:'/sample.Greeter/Hello', requestStream:false, responseStream:false,
    requestSerialize: value => Buffer.from(req.encode(req.fromObject(value)).finish()),
    requestDeserialize: bytes => req.toObject(req.decode(bytes)),
    responseSerialize: value => Buffer.from(rep.encode(rep.fromObject(value)).finish()),
    responseDeserialize: bytes => rep.toObject(rep.decode(bytes)),
  } };
  const reflectionRoot = protobuf.parse(REFLECTION_PROTO, { keepCase:true }).root;
  const reflectReq = reflectionRoot.lookupType('grpc.reflection.v1.ServerReflectionRequest');
  const reflectRes = reflectionRoot.lookupType('grpc.reflection.v1.ServerReflectionResponse');
  const serviceInfo = { ServerReflectionInfo: {
    path:'/grpc.reflection.v1.ServerReflection/ServerReflectionInfo',
    requestStream:true, responseStream:true,
    requestSerialize: value => Buffer.from(reflectReq.encode(reflectReq.fromObject(value)).finish()),
    requestDeserialize: bytes => reflectReq.toObject(reflectReq.decode(bytes)),
    responseSerialize: value => Buffer.from(reflectRes.encode(reflectRes.fromObject(value)).finish()),
    responseDeserialize: bytes => reflectRes.toObject(reflectRes.decode(bytes)),
  } };
  const fileSet = root.toDescriptor('proto3');
  const serialized = fileSet.file.map(file => Buffer.from(descriptor.FileDescriptorProto.encode(file).finish()));
  const server = new grpc.Server();
  server.addService(definition, { Hello(call, cb) { cb(null, { message: 'Hello ' + call.request.name }); } });
  server.addService(serviceInfo, { ServerReflectionInfo(stream) {
    stream.on('data', data => {
      if (Object.hasOwn(data, 'list_services')) {
        stream.write({ list_services_response: { service: [{ name:'sample.Greeter' }] } });
      } else if (data.file_containing_symbol === 'sample.Greeter') {
        stream.write({ file_descriptor_response: { file_descriptor_proto: serialized } });
      } else {
        stream.write({ error_response: { error_code:5, error_message:'Not found' } });
      }
    });
    stream.on('end', () => stream.end());
  }});
  const port = await listen(server);
  instances.push({grpcServer:server});
  return port;
}
async function startAgent() {
  const {server}=createAgent({port:0,token:'test-token',allowedHosts:['127.0.0.1'],allowedOrigins:['https://reqdock.convert-alpha.cc']});
  const port=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
  instances.push({agent:server});
  return port;
}

describe('in-memory multi-file .proto imports', () => {
  it('resolves imported request and response messages without filesystem reads', () => {
    const root = parseProtoFiles(SERVICE, [{name:'models/message.proto',content:MESSAGE}], 'main.proto');
    expect(root.lookupService('sample.Greeter')).toBeTruthy();
    const method = resolveUnaryMethod(SERVICE,'sample.Greeter','Hello',[{name:'models/message.proto',content:MESSAGE}]);
    expect(method.requestType.name).toBe('HelloRequest');
  });
  it('rejects missing, duplicate, invalid, oversized imports', () => {
    expect(()=>parseProtoFiles(SERVICE,[])).toThrow('Missing imported');
    expect(()=>parseProtoFiles(SERVICE,[{name:'models/message.proto',content:MESSAGE},{name:'models/message.proto',content:MESSAGE}])).toThrow('Duplicate');
    expect(()=>parseProtoFiles(SERVICE,[{name:'../secret.proto',content:MESSAGE}])).toThrow('Invalid');
    expect(()=>parseProtoFiles('x'.repeat(140*1024),[])).toThrow('128 KiB');
    expect(()=>parseProtoFiles(SERVICE,Array.from({length:32},(_,i)=>({name:'file'+i+'.proto',content:MESSAGE})))).toThrow('Too many');
  });
});
describe('authenticated gRPC reflection', () => {
  it('discovers a real service and uses its returned method descriptor for unary RPC', async () => {
    const port=await startReflectingServer();
    const settings={allowedHosts:new Set(['127.0.0.1']),agentPort:47831,
      metadataFactory:()=>new grpc.Metadata()};
    const services=await discoverGrpc({target:'grpc://127.0.0.1:'+port},settings);
    expect(services.services).toContain('sample.Greeter');
    const details=await discoverGrpc({target:'grpc://127.0.0.1:'+port,service:'sample.Greeter'},settings);
    expect(details.methods).toEqual([{name:'Hello',requestStream:false,responseStream:false}]);
    const result=await callGrpcUnary({target:'grpc://127.0.0.1:'+port,service:'sample.Greeter',method:'Hello',
      useReflection:true,message:{name:'ReqDock'},metadata:{}},settings);
    expect(result.response.message).toBe('Hello ReqDock');
  });
  it('uses the existing Agent auth and target policy for discovery', async () => {
    const rpcPort=await startReflectingServer(), agentPort=await startAgent();
    const endpoint='http://127.0.0.1:'+agentPort+'/grpc/discover';
    const body=JSON.stringify({target:'grpc://127.0.0.1:'+rpcPort});
    const unauthorized=await fetch(endpoint,{method:'POST',headers:{origin:'https://reqdock.convert-alpha.cc','content-type':'application/json'},body});
    expect(unauthorized.status).toBe(401);
    const allowed=await fetch(endpoint,{method:'POST',headers:{origin:'https://reqdock.convert-alpha.cc',
      'x-reqdock-agent-token':'test-token','content-type':'application/json'},body});
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).services).toContain('sample.Greeter');
    const rejected=await fetch(endpoint,{method:'POST',headers:{origin:'https://reqdock.convert-alpha.cc',
      'x-reqdock-agent-token':'test-token','content-type':'application/json'},
      body:JSON.stringify({target:'grpc://other.example.com:50051'})});
    expect(rejected.status).toBe(400);
  });
});
