import { describe, expect, it } from 'vitest';
import { onRequest } from '../functions/api/sync.js';

const envelope=seed=>({version:1,salt:'AAAAAAAAAAAAAAAAAAAAAA==',
  iv:'AAAAAAAAAAAAAAAA',ciphertext:Buffer.from('secret ciphertext '+seed).toString('base64')});

function fakeD1(){
  let current=null;
  const history=new Map();
  const capture=()=>{
    history.set(current.revision,{...current});
    for(const revision of history.keys())
      if(revision<=current.revision-20)history.delete(revision);
  };
  return {
    prepare(query){
      return {bind(...values){
        return {
          async first(){
            if(query.startsWith('SELECT data,updated_at,revision FROM reqdock_snapshot_history')){
              const row=history.get(values[1]);return row?{...row}:null;
            }
            if(query.startsWith('SELECT data,updated_at,revision FROM reqdock_snapshots'))
              return current?{...current}:null;
            if(query.startsWith('INSERT')){
              if(current)return null;
              current={data:values[1],updated_at:values[2],revision:1};
              capture();
              return {revision:1};
            }
            if(query.startsWith('UPDATE')){
              if(!current||current.revision!==values[3])return null;
              current={data:values[0],updated_at:values[1],revision:current.revision+1};
              capture();
              return {revision:current.revision};
            }
            throw Error('Unexpected SQL: '+query);
          },
          async all(){
            if(query.startsWith('SELECT revision,updated_at FROM reqdock_snapshot_history')){
              return {results:[...history.values()].sort((a,b)=>b.revision-a.revision)
                .slice(0,20).map(x=>({revision:x.revision,updated_at:x.updated_at}))};
            }
            throw Error('Unexpected SQL: '+query);
          },
        };
      }};
    },
  };
}
function call(env,method='GET',query='',payload,token='secret',origin='https://reqdock.example'){
  const request=new Request('https://reqdock.example/api/sync'+query,{
    method,
    headers:{Origin:origin,'X-ReqDock-Sync-Key':token,'Content-Type':'application/json'},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
  });
  return onRequest({request,env});
}

describe('encrypted cloud snapshot history',()=>{
  it('keeps the last 20 metadata records and fetches old ciphertext by revision',async()=>{
    const env={REQDOCK_DB:fakeD1(),REQDOCK_SYNC_KEY:'secret'};
    for(let rev=0;rev<22;rev++){
      const response=await call(env,'PUT','',{expectedRevision:rev,encrypted:envelope(rev)});
      expect(response.status).toBe(200);
      expect((await response.json()).revision).toBe(rev+1);
    }
    const listing=await call(env,'GET','?history=1');
    expect(listing.status).toBe(200);
    const {history}=await listing.json();
    expect(history).toHaveLength(20);
    expect(history[0].revision).toBe(22);
    expect(history.at(-1).revision).toBe(3);
    expect(JSON.stringify(history)).not.toContain('ciphertext');
    const entry=await call(env,'GET','?revision=3');
    expect((await entry.json()).encrypted).toEqual(envelope(2));
    expect((await call(env,'GET','?revision=1')).status).toBe(404);
    expect((await call(env,'GET')).status).toBe(200);
  });
  it('preserves monotonic revision when restoring ciphertext from an old revision',async()=>{
    const env={REQDOCK_DB:fakeD1(),REQDOCK_SYNC_KEY:'secret'};
    await call(env,'PUT','',{expectedRevision:0,encrypted:envelope('initial')});
    await call(env,'PUT','',{expectedRevision:1,encrypted:envelope('edited')});
    const previous=await (await call(env,'GET','?revision=1')).json();
    const reverted=await call(env,'PUT','',{expectedRevision:2,encrypted:previous.encrypted});
    expect((await reverted.json()).revision).toBe(3);
    const latest=await (await call(env,'GET')).json();
    expect(latest.encrypted).toEqual(previous.encrypted);
    expect(latest.revision).toBe(3);
    expect((await (await call(env,'GET','?revision=2')).json()).encrypted).toEqual(envelope('edited'));
    expect((await call(env,'PUT','',{expectedRevision:2,encrypted:previous.encrypted})).status).toBe(409);
    expect((await (await call(env,'GET','?history=1')).json()).history).toHaveLength(3);
  });
  it('requires authorization, rejects invalid queries, and does not leak ciphertext in history index',async()=>{
    const env={REQDOCK_DB:fakeD1(),REQDOCK_SYNC_KEY:'secret'};
    expect((await call(env,'GET','?history=1',undefined,'bad')).status).toBe(401);
    expect((await call(env,'GET','?revision=1',undefined,'bad')).status).toBe(401);
    expect((await call(env,'GET','?history=1',undefined,'secret','https://other.example')).status).toBe(403);
    for(const query of ['?revision=0','?revision=-1','?revision=1e3','?revision=1&history=1','?history=2']){
      expect((await call(env,'GET',query)).status).toBe(400);
    }
    const list=await (await call(env,'GET','?history=1')).json();
    expect(list.history).toEqual([]);
  });
});
