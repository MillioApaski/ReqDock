import {describe,expect,it} from 'vitest';
import { onRequest } from '../functions/api/sync.js';

const encrypted={version:1,salt:'AAAAAAAAAAAAAAAAAAAAAA==',iv:'AAAAAAAAAAAAAAAA',
  ciphertext:'AAAAAAAAAAAAAAAAAAAAAA=='};
function fakeDb(){
  let record=null;
  return { prepare(query){
    return {bind(...values){
      return {async first(){
        if(query.startsWith('SELECT'))return record&&{...record};
        if(query.startsWith('INSERT')){
          if(record)return null;
          record={data:values[1],updated_at:values[2],revision:1};
          return {revision:1};
        }
        if(query.startsWith('UPDATE')){
          if(!record||record.revision!==values[3])return null;
          record={data:values[0],updated_at:values[1],revision:record.revision+1};
          return {revision:record.revision};
        }
        throw Error('Unexpected SQL: '+query);
      }};
    }};
  }};
}
function request(method,body,token='secret'){
  return new Request('https://reqdock.example/api/sync',{
    method,headers:{Origin:'https://reqdock.example','X-ReqDock-Sync-Key':token,
      'Content-Type':'application/json'},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  });
}
describe('D1 revision compare-and-swap API',()=>{
  it('requires revision and blocks legacy unversioned overwrites',async()=>{
    const env={REQDOCK_DB:fakeDb(),REQDOCK_SYNC_KEY:'secret'};
    const legacy=await onRequest({request:request('PUT',encrypted),env});
    expect(legacy.status).toBe(428);
    const invalid=await onRequest({request:request('PUT',{encrypted,expectedRevision:-1}),env});
    expect(invalid.status).toBe(428);
    const unauth=await onRequest({request:request('PUT',{encrypted,expectedRevision:0},'wrong'),env});
    expect(unauth.status).toBe(401);
  });
  it('creates revision one, increments and blocks stale clients',async()=>{
    const env={REQDOCK_DB:fakeDb(),REQDOCK_SYNC_KEY:'secret'};
    expect((await onRequest({request:request('GET'),env})).status).toBe(404);
    const [first,second]=await Promise.all([
      onRequest({request:request('PUT',{encrypted,expectedRevision:0}),env}),
      onRequest({request:request('PUT',{encrypted,expectedRevision:0}),env}),
    ]);
    expect([first.status,second.status].sort()).toEqual([200,409]);
    const read=await onRequest({request:request('GET'),env});
    expect((await read.json()).revision).toBe(1);
    const accepted=await onRequest({request:request('PUT',{encrypted,expectedRevision:1}),env});
    expect((await accepted.json()).revision).toBe(2);
    const stale=await onRequest({request:request('PUT',{encrypted,expectedRevision:1}),env});
    expect(stale.status).toBe(409);
    const final=await onRequest({request:request('GET'),env});
    expect((await final.json()).revision).toBe(2);
  });
});
