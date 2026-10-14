import type { Collection, Environment, Folder, GrpcRequestPreset, RequestModel } from '../types';

export type Workspace = {
  requests: RequestModel[];
  environments: Environment[];
  collections: Collection[];
  folders: Folder[];
  grpcRequests: GrpcRequestPreset[];
};
export type WorkspaceField = keyof Workspace;
export type Resolution = 'local' | 'remote';
export type Conflict = { key:string; field:WorkspaceField; id:string; name:string; reason:string };
export type MergeResult = { workspace:Workspace; conflicts:Conflict[]; unresolved:number; resurrected:number };

const FIELDS:WorkspaceField[]=['collections','folders','requests','grpcRequests','environments'];

function stable(value:unknown):string {
  if(value===undefined) return 'undefined';
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.entries(value)
    .sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';
  return JSON.stringify(value);
}
function equal(a:unknown,b:unknown):boolean {return stable(a)===stable(b);}
function entities(list:readonly {id:string}[]):Map<string,{id:string}> {
  const m=new Map<string,{id:string}>();
  for(const item of list){
    if(!item || typeof item.id!=='string'||!item.id||m.has(item.id))
      throw Error('Invalid or duplicate entity ID in workspace.');
    m.set(item.id,item);
  }
  return m;
}
export function mergeWorkspace(base:Workspace,local:Workspace,remote:Workspace,
  resolutions:Record<string,Resolution>={}):MergeResult {
  const out={} as Workspace;
  const conflicts:Conflict[]=[];
  let unresolved=0;
  for(const field of FIELDS) {
    const a=entities(base[field]),b=entities(local[field]),c=entities(remote[field]);
    const ids=new Set([...a.keys(),...b.keys(),...c.keys()]);
    const collected:{id:string}[]=[];
    for(const id of ids) {
      const before=a.get(id),mine=b.get(id),theirs=c.get(id);
      const localChanged=!equal(mine,before),remoteChanged=!equal(theirs,before);
      let selected:typeof mine;
      if(!localChanged) selected=theirs;
      else if(!remoteChanged||equal(mine,theirs)) selected=mine;
      else {
        const key=field+':'+id;
        const choice=resolutions[key];
        if(choice!=='local'&&choice!=='remote') unresolved++;
        const name=(mine || theirs || before) as {name?:string}|undefined;
        conflicts.push({key,field,id,name:name?.name||id.slice(0,12),
          reason:!mine||!theirs?'A deletion conflicts with a change.':'Both devices modified this item.'});
        selected=choice==='remote'?theirs:mine;
      }
      if(selected) collected.push(selected);
    }
    // Type-independent merging keeps entities intact and avoids field-level
    // corruption of auth, protobuf messages and user-defined scripts.
    (out as unknown as Record<WorkspaceField,unknown>)[field]=collected;
  }
  // The browser represents Collections/Folder ancestry as references. Retain
  // a referenced container instead of silently orphaning a preserved request.
  let resurrected=0;
  const collections=new Map(out.collections.map(x=>[x.id,x]));
  const folders=new Map(out.folders.map(x=>[x.id,x]));
  const knownCollections=new Map([...base.collections,...remote.collections,...local.collections].map(x=>[x.id,x]));
  const knownFolders=new Map([...base.folders,...remote.folders,...local.folders].map(x=>[x.id,x]));
  const ensureCollection=(id:string|undefined)=>{
    if(!id||collections.has(id)) return;
    const match=knownCollections.get(id);
    if(match) {collections.set(id,match);resurrected++;}
  };
  const ensureFolder=(id:string|undefined,depth=0)=>{
    if(!id||depth>30||folders.has(id))return;
    const match=knownFolders.get(id);
    if(match){folders.set(id,match);resurrected++;ensureCollection(match.collectionId);ensureFolder(match.parentId,depth+1);}
  };
  for(const item of out.requests){ensureCollection(item.collectionId);ensureFolder(item.folderId);}
  for(const item of out.grpcRequests)ensureCollection(item.collectionId);
  for(const item of out.folders){ensureCollection(item.collectionId);ensureFolder(item.parentId);}
  for(const item of folders.values())ensureCollection(item.collectionId);
  out.collections=[...collections.values()];
  out.folders=[...folders.values()];
  return {workspace:out,conflicts,unresolved,resurrected};
}
export const emptyWorkspace=():Workspace=>({
  requests:[],environments:[],collections:[],folders:[],grpcRequests:[],
});
