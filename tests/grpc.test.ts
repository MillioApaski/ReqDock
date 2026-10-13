import { afterEach, describe, expect, it } from 'vitest';
import { createAgent } from '../agent/reqdock-agent.mjs';
import { callGrpcUnary, resolveUnaryMethod, validateGrpcTarget } from '../agent/grpc.mjs';
import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';

const PROTO = [
  'syntax = "proto3";',
  'package demo;',
  'service Greeter { rpc SayHello (HelloRequest) returns (HelloReply); }',
  'message HelloRequest { string name = 1; }',
  'message HelloReply { string message = 1; }',
].join('\n');
const META = { origin:'https://reqdock.convert-alpha.cc', 'x-reqdock-agent-token':'test-token', 'content-type':'application/json' };
const running = [];
afterEach(async () => {
  for (const { agent, grpcServer } of running.splice(0)) {
    if (agent) await new Promise(resolve => agent.close(resolve));
    if (grpcServer) grpcServer.forceShutdown();
  }
});
async function startGrpc() {
  const root = protobuf.parse(PROTO).root;
  const Req = root.lookupType('demo.HelloRequest'), Res = root.lookupType('demo.HelloReply');
  const definition = { SayHello: {
    path:'/demo.Greeter/SayHello', requestStream:false, responseStream:false, originalName:'SayHello',
    requestSerialize:value => Buffer.from(Req.encode(Req.fromObject(value)).finish()),
    requestDeserialize:bytes => Req.toObject(Req.decode(bytes)),
    responseSerialize:value => Buffer.from(Res.encode(Res.fromObject(value)).finish()),
    responseDeserialize:bytes => Res.toObject(Res.decode(bytes)),
  } };
  const server = new grpc.Server();
  server.addService(definition, { SayHello(call, cb) { cb(null, { message:'Hello ' + call.request.name }); } });
  const port = await new Promise((resolve,reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => err ? reject(err) : resolve(port));
  });
  running.push({ grpcServer:server });
  return port;
}
async function startAgent() {
  const { server } = createAgent({ port:0, token:'test-token', allowedOrigins:['https://reqdock.convert-alpha.cc'], allowedHosts:['127.0.0.1'] });
  const port = await new Promise(resolve => server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
  running.push({ agent:server });
  return port;
}
const payload = (port) => ({
  target:'grpc://127.0.0.1:' + port, proto:PROTO, service:'demo.Greeter', method:'SayHello',
  message:{ name:'ReqDock' }, metadata:{ 'x-request-id':'hello-1' },
});

describe('gRPC unary implementation', () => {
  it('rejects targets outside the exact allowlist, self-calls and invalid schemes', () => {
    const hosts = new Set(['localhost', '127.0.0.1']);
    expect(()=>validateGrpcTarget('grpc://evil.example.com:50051',hosts,47831)).toThrow('allowlist');
    expect(()=>validateGrpcTarget('grpc://127.0.0.1:47831',hosts,47831)).toThrow('itself');
    expect(()=>validateGrpcTarget('http://127.0.0.1:50051',hosts,47831)).toThrow();
    expect(()=>validateGrpcTarget('grpc://user:pass@127.0.0.1:50051',hosts,47831)).toThrow();
    expect(()=>validateGrpcTarget('grpc://127.0.0.1:50051/bad',hosts,47831)).toThrow();
  });
  it('rejects proto imports and streaming methods', () => {
    expect(()=>resolveUnaryMethod('syntax = "proto3"; import "google/protobuf/empty.proto"; service A { rpc Go(Empty) returns (Empty); }',
      'A','Go')).toThrow('Imported');
    const streaming='syntax = "proto3"; message Msg { string text = 1; } service Chat { rpc Watch(Msg) returns (stream Msg); }';
    expect(()=>resolveUnaryMethod(streaming,'Chat','Watch')).toThrow('Only unary');
  });
  it('performs a real local HTTP/2 unary RPC and decodes JSON', async () => {
    const port=await startGrpc();
    const out=await callGrpcUnary(payload(port),{allowedHosts:new Set(['127.0.0.1']),agentPort:47831});
    expect(out.status).toBe(0);
    expect(out.response).toEqual({message:'Hello ReqDock'});
  });
  it('only allows the paired browser origin to call the local gRPC endpoint', async () => {
    const rpcPort=await startGrpc(), agentPort=await startAgent();
    const endpoint='http://127.0.0.1:' + agentPort + '/grpc/unary';
    const denied=await fetch(endpoint,{method:'POST',headers:{...META,origin:'https://evil.example'},body:JSON.stringify(payload(rpcPort))});
    expect(denied.status).toBe(403);
    const unauthorized=await fetch(endpoint,{method:'POST',headers:{...META,'x-reqdock-agent-token':'incorrect'},body:JSON.stringify(payload(rpcPort))});
    expect(unauthorized.status).toBe(401);
    const response=await fetch(endpoint,{method:'POST',headers:META,body:JSON.stringify(payload(rpcPort))});
    expect(response.status).toBe(200);
    expect((await response.json()).response.message).toBe('Hello ReqDock');
    const notAllowed=await fetch(endpoint,{method:'POST',headers:META,
      body:JSON.stringify({...payload(rpcPort),target:'grpc://other.example.com:50051'})});
    expect(notAllowed.status).toBe(400);
  });
});
