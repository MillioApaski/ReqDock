import { afterEach, describe, expect, it } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';
import { createAgent } from '../agent/reqdock-agent.mjs';
import { consumeGrpcStream } from '../src/lib/grpc-stream';

const PROTO = [
  'syntax = "proto3"; package sample;',
  'service Updates { rpc Watch (Query) returns (stream Update); rpc Echo (Query) returns (Update); }',
  'message Query { string name = 1; } message Update { string message = 1; }',
].join('\n');
const active = [];
const listen = server => new Promise((resolve,reject) => server.bindAsync('127.0.0.1:0',
  grpc.ServerCredentials.createInsecure(),(error,port) => error ? reject(error) : resolve(port)));
afterEach(async () => {
  for (const instance of active.splice(0)) {
    if (instance.agent) await new Promise(resolve => instance.agent.close(resolve));
    if (instance.grpcServer) instance.grpcServer.forceShutdown();
  }
});
async function setup() {
  const root=protobuf.parse(PROTO).root;
  const query=root.lookupType('sample.Query'), update=root.lookupType('sample.Update');
  const def={
    Watch:{path:'/sample.Updates/Watch',requestStream:false,responseStream:true,
      requestSerialize:value=>Buffer.from(query.encode(query.fromObject(value)).finish()),
      requestDeserialize:bytes=>query.toObject(query.decode(bytes)),
      responseSerialize:value=>Buffer.from(update.encode(update.fromObject(value)).finish()),
      responseDeserialize:bytes=>update.toObject(update.decode(bytes))},
    Echo:{path:'/sample.Updates/Echo',requestStream:false,responseStream:false,
      requestSerialize:value=>Buffer.from(query.encode(query.fromObject(value)).finish()),
      requestDeserialize:bytes=>query.toObject(query.decode(bytes)),
      responseSerialize:value=>Buffer.from(update.encode(update.fromObject(value)).finish()),
      responseDeserialize:bytes=>update.toObject(update.decode(bytes))},
  };
  const grpcServer=new grpc.Server();
  grpcServer.addService(def,{
    Watch(call) { let i=0; const timer=setInterval(()=>{
      if (call.cancelled) {clearInterval(timer);return;}
      call.write({message:call.request.name+'-'+(++i)});
      if (i===3) {clearInterval(timer);call.end();}
    },8); call.on('cancelled',()=>clearInterval(timer)); },
    Echo(call,cb){cb(null,{message:call.request.name});},
  });
  const rpcPort=await listen(grpcServer);
  active.push({grpcServer});
  const {server}=createAgent({port:0,token:'test-stream-key',allowedHosts:['127.0.0.1'],
    allowedOrigins:['https://reqdock.convert-alpha.cc']});
  const port=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
  active.push({agent:server});
  return {rpcPort,port};
}
const payload=(port,method='Watch')=>({
  target:'grpc://127.0.0.1:'+port,proto:PROTO,service:'sample.Updates',method,
  message:{name:'update'},metadata:{},
});
const headers={origin:'https://reqdock.convert-alpha.cc','Content-Type':'application/json','X-ReqDock-Agent-Token':'test-stream-key'};
describe('gRPC server streaming HTTP bridge',()=>{
  it('emits incremental messages and a terminal completion event',async()=>{
    const {port,rpcPort}=await setup();
    const res=await fetch('http://127.0.0.1:'+port+'/grpc/stream',
      {method:'POST',headers,body:JSON.stringify(payload(rpcPort))});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events=[];
    await consumeGrpcStream(res.body,event=>events.push(event));
    expect(events.filter(event=>event.type==='message').map(event=>event.data.message))
      .toEqual(['update-1','update-2','update-3']);
    expect(events.at(-1)).toMatchObject({type:'complete',status:0,count:3});
  });
  it('rejects wrong tokens and returns an explicit error for non-stream RPC',async()=>{
    const {port,rpcPort}=await setup();
    const endpoint='http://127.0.0.1:'+port+'/grpc/stream';
    const unauthorized=await fetch(endpoint,{method:'POST',headers:{...headers,'X-ReqDock-Agent-Token':'wrong'},
      body:JSON.stringify(payload(rpcPort))});
    expect(unauthorized.status).toBe(401);
    const wrongOrigin=await fetch(endpoint,{method:'POST',headers:{...headers,origin:'https://other.example'},
      body:JSON.stringify(payload(rpcPort))});
    expect(wrongOrigin.status).toBe(403);
    const res=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(payload(rpcPort,'Echo'))});
    const events=[];
    await consumeGrpcStream(res.body,event=>events.push(event));
    expect(events.at(-1)).toMatchObject({type:'error'});
    expect(events.at(-1).error).toContain('server-streaming');
  });
});
