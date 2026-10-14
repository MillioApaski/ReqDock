import { describe, expect, it } from 'vitest';
import { workspaceFingerprint } from '../src/lib/auto-sync';
import { emptyWorkspace, mergeWorkspace, type Workspace } from '../src/lib/workspace-merge';

const request=(id:string,name:string)=>({
  id,name,collectionId:'c',method:'GET' as const,url:'https://example.test/'+name,
  headers:[],bodyType:'none' as const,body:'',auth:{
    type:'none' as const,token:'',username:'',password:'',key:'',value:'',location:'header' as const,
  },updatedAt:1,
});
const workspace=(requests:ReturnType<typeof request>[]):Workspace=>({
  ...emptyWorkspace(),collections:[{id:'c',name:'API',createdAt:1}],requests,
});

describe('automatic sync safety decisions',()=>{
  it('does not detect false differences when only entity ordering changes',()=>{
    const one=workspace([request('1','one'),request('2','two')]);
    const two=workspace([...one.requests].reverse() as ReturnType<typeof request>[]);
    expect(workspaceFingerprint(one)).toBe(workspaceFingerprint(two));
  });
  it('detects changes even to metadata and request bodies',()=>{
    const before=workspace([request('1','one')]);
    const after=workspace([{...request('1','one'),headers:[{
      id:'secret',key:'Authorization',value:'Bearer abc',enabled:true,
    }]}]);
    expect(workspaceFingerprint(before)).not.toBe(workspaceFingerprint(after));
  });
  it('allows auto-merging independent edits without making a conflict decision',()=>{
    const base=workspace([request('1','original')]);
    const local=workspace([request('1','original'),request('2','local')]);
    const remote=workspace([request('1','cloud')]);
    const outcome=mergeWorkspace(base,local,remote);
    expect(outcome.unresolved).toBe(0);
    expect(outcome.workspace.requests.map(x=>x.name).sort()).toEqual(['cloud','local']);
  });
  it('requires manual choice for concurrent edits and delete-modify races',()=>{
    const base=workspace([request('1','original')]);
    const remote=workspace([request('1','remote')]);
    expect(mergeWorkspace(base,workspace([request('1','local')]),remote).unresolved).toBe(1);
    expect(mergeWorkspace(base,workspace([]),remote).unresolved).toBe(1);
  });
});
