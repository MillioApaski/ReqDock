import {describe,expect,it} from 'vitest';
import { emptyWorkspace, mergeWorkspace, type Workspace } from '../src/lib/workspace-merge';

const collection=(id:string,name:string)=>({id,name,createdAt:1});
const request=(id:string,name:string,collectionId='c')=>({
  id,name,method:'GET' as const,url:'https://example.com/'+name,
  headers:[],bodyType:'none' as const,body:'',auth:{
    type:'none' as const,token:'',username:'',password:'',key:'',value:'',location:'header' as const,
  },updatedAt:1,collectionId,
});
const workspace=(requestName?:string):Workspace=>({
  ...emptyWorkspace(), collections:[collection('c','Main')],
  requests:requestName?[request('r1',requestName)]:[],
});

describe('encrypted workspace three-way merge decisions',()=>{
  it('unions first-time devices without inventing deletions',()=>{
    const local=workspace('one');
    const remote:Workspace={...workspace(),requests:[request('r2','two')]};
    const result=mergeWorkspace(emptyWorkspace(),local,remote);
    expect(result.conflicts).toHaveLength(0);
    expect(result.workspace.requests.map(x=>x.id)).toEqual(['r1','r2']);
    expect(result.unresolved).toBe(0);
  });
  it('propagates unrelated additions and unopposed edits',()=>{
    const base=workspace('old'),local=workspace('edited'),remote:Workspace={
      ...workspace('old'),grpcRequests:[{
        id:'g',name:'rpc',collectionId:'c',updatedAt:5,target:'grpc://localhost:50051',
        proto:'syntax = "proto3";',entryName:'main.proto',protoFiles:[],source:'files',
        service:'Service',method:'Method',message:'{}',metadata:'{}',callMode:'unary',
      }],
    };
    const result=mergeWorkspace(base,local,remote);
    expect(result.workspace.requests[0].name).toBe('edited');
    expect(result.workspace.grpcRequests).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });
  it('preserves changes against deletion and requires explicit choice',()=>{
    const base=workspace('old'),local=workspace(),remote=workspace('cloud-edited');
    const plan=mergeWorkspace(base,local,remote);
    expect(plan.conflicts).toMatchObject([{
      key:'requests:r1',reason:'A deletion conflicts with a change.',
    }]);
    expect(plan.unresolved).toBe(1);
    expect(mergeWorkspace(base,local,remote,{'requests:r1':'local'}).workspace.requests).toEqual([]);
    expect(mergeWorkspace(base,local,remote,{'requests:r1':'remote'}).workspace.requests[0].name).toBe('cloud-edited');
  });
  it('does not silently prefer local/remote on double edit',()=>{
    const base=workspace('old'),local=workspace('local-edit'),remote=workspace('cloud-edit');
    expect(mergeWorkspace(base,local,remote).unresolved).toBe(1);
    expect(mergeWorkspace(base,local,remote,{'requests:r1':'local'}).workspace.requests[0].name).toBe('local-edit');
    expect(mergeWorkspace(base,local,remote,{'requests:r1':'remote'}).workspace.requests[0].name).toBe('cloud-edit');
  });
  it('propagates deletions when the other side is unchanged',()=>{
    const base=workspace('old'),local=workspace(),remote=workspace('old');
    expect(mergeWorkspace(base,local,remote).workspace.requests).toHaveLength(0);
    expect(mergeWorkspace(base,remote,local).workspace.requests).toHaveLength(0);
  });
  it('retains parent Collection if a merged request still references it',()=>{
    const base=workspace('old');
    const local:Workspace={...workspace('old'),collections:[]};
    const remote=workspace('new remote');
    const merged=mergeWorkspace(base,local,remote,{'requests:r1':'remote'});
    expect(merged.workspace.collections.map(c=>c.id)).toContain('c');
    expect(merged.resurrected).toBeGreaterThan(0);
  });
  it('rejects duplicate IDs rather than dropping records',()=>{
    const base=workspace('old');
    expect(()=>mergeWorkspace(base,{...base,requests:[base.requests[0],base.requests[0]]},base))
      .toThrow('duplicate entity ID');
  });
});
