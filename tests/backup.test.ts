import { describe, expect, it } from 'vitest';
import { readBackup } from '../src/lib/export';

const request = {
  id:'g-123',name:'Streaming hello',collectionId:'col-1',updatedAt:100,
  target:'grpc://127.0.0.1:50051',proto:'syntax = "proto3";',entryName:'main.proto',
  protoFiles:[],source:'files',service:'sample.Greeter',method:'Chat',
  message:'{"text":"hello"}',metadata:'{"authorization":"Bearer secret"}',callMode:'bidi',
};
const fixture = {
  version:3,requests:[],environments:[],collections:[{id:'col-1',name:'API',createdAt:1}],
  folders:[],grpcRequests:[request],
};
describe('ReqDock v3 workspace backups',()=>{
  it('roundtrips all saved RPC data, including Proto and call mode',()=>{
    const data=readBackup(JSON.parse(JSON.stringify(fixture)));
    expect(data.grpcRequests).toEqual([request]);
    expect(data.grpcRequests[0].metadata).toContain('Bearer secret');
  });
  it('accepts version 1 and 2 backups without gRPC request data',()=>{
    for (const version of [1,2]) {
      const old=readBackup({version,requests:[],environments:[],collections:[],folders:[]});
      expect(old.grpcRequests).toEqual([]);
    }
  });
  it('rejects malformed v3 backup and ignores invalid RPC records',()=>{
    expect(()=>readBackup({...fixture,grpcRequests:undefined})).toThrow('missing its gRPC');
    const next=readBackup({...fixture,grpcRequests:[request,{...request,id:'oops',source:'random'},{...request,id:'bad',protoFiles:[{name:'broken.proto',content:7}]}]});
    expect(next.grpcRequests.map(r=>r.id)).toEqual(['g-123']);
  });
});
