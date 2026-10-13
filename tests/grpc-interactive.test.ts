import { afterEach, describe, expect, it } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';
import { createAgent } from '../agent/reqdock-agent.mjs';
import { runGrpcCollection } from '../src/lib/grpc-runner';
import { consumeGrpcStream } from '../src/lib/grpc-stream';

const PROTO = [
  'syntax = "proto3"; package test;',
  'service Chat { rpc Collect (stream Input) returns (Output); rpc Talk (stream Input) returns (stream Output); }',
  'message Input { string text = 1; } message Output { string text = 1; }',
].join('\n');
const instances = [];
const ORIGIN = 'https://reqdock.convert-alpha.cc';
const auth = { origin:ORIGIN, 'X-ReqDock-Agent-Token':'test-secret', 'Content-Type':'application/json' };
afterEach(async () => {
  for (const {agent, server} of instances.splice(0)) {
    if (agent) await new Promise(resolve => agent.close(resolve));
    if (server) server.forceShutdown();
  }
});
async function setup() {
  const root=protobuf.parse(PROTO).root;
  const input=root.lookupType('test.Input'), output=root.lookupType('test.Output');
  function definition(name, responseStream) {
    return { path:'/test.Chat/'+name, requestStream:true, responseStream,
      requestSerialize:v=>Buffer.from(input.encode(input.fromObject(v)).finish()),
      requestDeserialize:b=>input.toObject(input.decode(b)),
      responseSerialize:v=>Buffer.from(output.encode(output.fromObject(v)).finish()),
      responseDeserialize:b=>output.toObject(output.decode(b)),
    };
  }
  const server=new grpc.Server();
  server.addService({ Collect:definition('Collect',false),Talk:definition('Talk',true) },{
    Collect(call,cb) {
      const items=[]; call.on('data',item=>items.push(item.text));
      call.on('end',()=>cb(null,{text:items.join('|')}));
    },
    Talk(call) {
      call.on('data',item=>call.write({text:'echo:'+item.text}));
      call.on('end',()=>call.end());
    },
  });
  const rpcPort=await new Promise((resolve,reject)=>server.bindAsync('127.0.0.1:0',
    grpc.ServerCredentials.createInsecure(),(err,port)=>err?reject(err):resolve(port)));
  instances.push({server});
  const {server:agent}=createAgent({port:0,token:'test-secret',allowedHosts:['127.0.0.1'],allowedOrigins:[ORIGIN]});
  const port=await new Promise(resolve=>agent.listen(0,'127.0.0.1',()=>resolve(agent.address().port)));
  instances.push({agent});
  return {base:'http://127.0.0.1:'+port,rpcPort};
}
async function post(url,payload={},headers=auth) {
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)});
  return { status:res.status, body:await res.json() };
}
const rpcPayload=(port,method)=>({target:'grpc://127.0.0.1:'+port,proto:PROTO,service:'test.Chat',method,metadata:{}});
describe('interactive gRPC session API',()=>{
  it('collects several client messages and responds only after Half-close',async()=>{
    const {base,rpcPort}=await setup();
    const {status,body}=await post(base+'/grpc/session',rpcPayload(rpcPort,'Collect'));
    expect(status).toBe(201);
    expect(body.mode).toBe('client-stream');
    const api=base+'/grpc/session/'+body.id;
    expect((await post(api+'/message',{message:{text:'one'}})).body.sent).toBe(1);
    expect((await post(api+'/message',{message:{text:'two'}})).body.sent).toBe(2);
    expect((await post(api+'/finish')).status).toBe(200);
    expect((await post(api+'/message',{message:{text:'three'}})).status).toBe(400);
    const events=await fetch(api+'/events',{headers:auth});
    const received=[];
    await consumeGrpcStream(events.body,event=>received.push(event));
    expect(received.filter(x=>x.type==='message').map(x=>x.data.text)).toEqual(['one|two']);
    expect(received.at(-1)).toMatchObject({type:'complete',count:1,status:0});
  });
  it('receives live bidi responses before send-side Half-close',async()=>{
    const {base,rpcPort}=await setup();
    const {body}=await post(base+'/grpc/session',rpcPayload(rpcPort,'Talk'));
    expect(body.mode).toBe('bidi');
    const api=base+'/grpc/session/'+body.id;
    const eventsPromise=fetch(api+'/events',{headers:auth});
    expect((await post(api+'/message',{message:{text:'alpha'}})).status).toBe(200);
    const response=await eventsPromise;
    expect(response.status).toBe(200);
    const received=[];
    const consume=consumeGrpcStream(response.body,event=>received.push(event));
    expect((await post(api+'/message',{message:{text:'beta'}})).status).toBe(200);
    expect((await post(api+'/finish')).status).toBe(200);
    await consume;
    expect(received.filter(x=>x.type==='message').map(x=>x.data.text)).toEqual(['echo:alpha','echo:beta']);
    expect(received.at(-1)).toMatchObject({type:'complete',count:2});
  });
  it('rejects foreign origin, token, host and inappropriate unary methods',async()=>{
    const {base,rpcPort}=await setup();
    const noAuth=await post(base+'/grpc/session',rpcPayload(rpcPort,'Talk'),{...auth,'X-ReqDock-Agent-Token':'wrong'});
    expect(noAuth.status).toBe(401);
    const wrongHost=await post(base+'/grpc/session',{...rpcPayload(rpcPort,'Talk'),target:'grpc://other.example:50051'});
    expect(wrongHost.status).toBe(400);
    const {body}=await post(base+'/grpc/session',rpcPayload(rpcPort,'Talk'));
    const api=base+'/grpc/session/'+body.id;
    expect((await fetch(api+'/events',{headers:{...auth,origin:'https://evil.example'}})).status).toBe(403);
    expect((await post(api+'/message',{message:{text:'x'}},{...auth,'X-ReqDock-Agent-Token':'wrong'})).status).toBe(401);
    expect((await post(api+'/cancel')).status).toBe(200);
    const events=await fetch(api+'/events',{headers:auth});
    const received=[];
    await consumeGrpcStream(events.body,event=>received.push(event));
    expect(received.at(-1)).toMatchObject({type:'error',error:'gRPC session cancelled.'});
  });
});


describe('gRPC Collection Runner: real client/bidi streaming', () => {
  const preset=(port, method, callMode, message)=>({
    id:'rpc-'+method, name:'Saved '+method, collectionId:'col',
    updatedAt:1, target:'grpc://127.0.0.1:'+port,
    proto:PROTO, protoFiles:[], entryName:'main.proto', source:'files',
    service:'test.Chat', method, message, metadata:'{"authorization":"Bearer private-secret"}',
    callMode,
  });
  it('sends a JSON array, half-closes and returns credential-free progress',async()=>{
    const {base,rpcPort}=await setup();
    const updates=[];
    const results=await runGrpcCollection([
      preset(rpcPort,'Collect','client-stream','[{"text":"one"},{"text":"two"}]'),
      preset(rpcPort,'Talk','bidi','[{"text":"alpha"},{"text":"beta"}]'),
    ],undefined,'test-secret',new AbortController().signal,{
      endpoint:base, onProgress:items=>updates.push(items),
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({status:0,messageCount:1,mode:'client-stream'});
    expect(results[1]).toMatchObject({status:0,messageCount:2,mode:'bidi'});
    expect(updates).toHaveLength(2);
    const report=JSON.stringify(results);
    expect(report).not.toContain('private-secret');
    expect(report).not.toContain('one|two');
    expect(report).not.toContain('test-secret');
  });
  it('rejects missing Agent pairing and malformed client message arrays',async()=>{
    const a=preset(50051,'Collect','client-stream','[1,2]');
    const noToken=await runGrpcCollection([a],undefined,'',new AbortController().signal);
    expect(noToken[0].error).toContain('not paired');
    const invalid=await runGrpcCollection([a],undefined,'test-secret',new AbortController().signal);
    expect(invalid[0].error).toContain('Stream messages');
  });
  it('does not execute any requests when cancelled before the run',async()=>{
    const controller=new AbortController();controller.abort();
    const items=await runGrpcCollection([preset(50051,'Collect','client-stream','{}')],
      undefined,'test-secret',controller.signal);
    expect(items).toEqual([]);
  });
});
