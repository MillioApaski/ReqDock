import { useState } from 'react';
import { Check, Cloud, Download, ShieldAlert } from 'lucide-react';
import { db } from '../lib/storage';
import { encryptBackup, decryptBackup, optionalCloudSnapshot, readCloudSnapshot,
  writeCloudSnapshot, CloudVersionConflict } from '../lib/sync';
import { readBackup } from '../lib/export';
import { emptyWorkspace, mergeWorkspace, type Workspace, type Conflict, type Resolution } from '../lib/workspace-merge';
import { newId, type Collection } from '../types';

type Preview = {
  local:Workspace; remote:Workspace; base:Workspace; revision:number;
  bootstrap:boolean; conflicts:Conflict[];
};

async function loadLocal():Promise<Workspace>{
  return {
    requests:await db.requests.toArray(), environments:await db.environments.toArray(),
    collections:await db.collections.toArray(), folders:await db.folders.toArray(),
    grpcRequests:await db.grpcRequests.toArray(),
  };
}
const fingerprint=(value:Workspace)=>{
  const sorted:Record<string,unknown>={};
  for(const field of ['requests','environments','collections','folders','grpcRequests'] as const){
    sorted[field]=[...value[field]].sort((a,b)=>a.id.localeCompare(b.id));
  }
  return JSON.stringify(sorted);
};

export function SyncPanel({onApplied}:{onApplied:(data:Workspace)=>void}){
  const [key,setKey]=useState('');
  const [passphrase,setPassphrase]=useState('');
  const [busy,setBusy]=useState(false);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [choices,setChoices]=useState<Record<string,Resolution>>({});
  const [status,setStatus]=useState('');
  const enabled=!!key&&passphrase.length>=12&&!busy;
  const resetPreview=()=>{setPreview(null);setChoices({});};

  async function review(){
    if(!enabled)return;
    setBusy(true);resetPreview();setStatus('');
    try {
      const local=await loadLocal();
      const remoteSnapshot=await optionalCloudSnapshot(key);
      const revision=remoteSnapshot?.revision||0;
      const last=await db.syncBase.get('default');
      if(last&&last.revision>revision)
        throw Error('Cloud history was rolled back or reset. Export your local workspace and review server configuration first.');
      const remote=remoteSnapshot?readBackup(await decryptBackup(remoteSnapshot.encrypted,passphrase)):emptyWorkspace();
      const base=last?readBackup(await decryptBackup(last.encrypted,passphrase)):emptyWorkspace();
      const result=mergeWorkspace(base,local,remote);
      if(result.conflicts.length>250)throw Error('More than 250 conflicting records. Export both workspaces for manual review.');
      setPreview({local,remote,base,revision,bootstrap:!last&&!!remoteSnapshot,conflicts:result.conflicts});
      setStatus(result.conflicts.length?'Resolve every conflict before confirming.':'Review the summary, then confirm synchronization.');
    }catch(error){setStatus(error instanceof Error?error.message:'Cannot read encrypted cloud workspace.');}
    finally{setBusy(false);}
  }

  async function apply(){
    if(!enabled||!preview)return;
    const plan=preview;
    const merged=mergeWorkspace(plan.base,plan.local,plan.remote,choices);
    if(merged.unresolved){setStatus('Choose local or cloud for every conflicting record.');return;}
    if(!window.confirm('Synchronize '+merged.workspace.requests.length+' HTTP and '+
      merged.workspace.grpcRequests.length+' gRPC requests? Cloud revision '+plan.revision+
      ' will advance. This also updates the local workspace.'))return;
    setBusy(true);setStatus('');
    try {
      const latest=await loadLocal();
      if(fingerprint(latest)!==fingerprint(plan.local))
        throw Error('Local data changed during review. Click Review sync changes again.');
      const encrypted=await encryptBackup({version:3,...merged.workspace},passphrase);
      const saved=await writeCloudSnapshot(encrypted,key,plan.revision);
      let replaced=false;
      await db.transaction('rw',db.requests,db.environments,db.collections,db.folders,db.grpcRequests,db.syncBase,async()=>{
        const current:Workspace={
          requests:await db.requests.toArray(),environments:await db.environments.toArray(),
          collections:await db.collections.toArray(),folders:await db.folders.toArray(),
          grpcRequests:await db.grpcRequests.toArray(),
        };
        if(fingerprint(current)===fingerprint(plan.local)){
          await Promise.all([db.requests.clear(),db.environments.clear(),db.collections.clear(),
            db.folders.clear(),db.grpcRequests.clear()]);
          await db.collections.bulkPut(merged.workspace.collections);
          await db.folders.bulkPut(merged.workspace.folders);
          await db.requests.bulkPut(merged.workspace.requests);
          await db.grpcRequests.bulkPut(merged.workspace.grpcRequests);
          await db.environments.bulkPut(merged.workspace.environments);
          replaced=true;
        }
        await db.syncBase.put({id:'default',revision:saved.revision,encrypted});
      });
      resetPreview();
      if(replaced){
        onApplied(merged.workspace);
        setStatus('Synchronized successfully. Cloud revision '+saved.revision+'.');
      }else{
        setStatus('Cloud updated, but new local edits occurred during upload. Those edits were preserved. Review and sync again.');
      }
    }catch(error){
      if(error instanceof CloudVersionConflict) resetPreview();
      setStatus(error instanceof Error?error.message:'Cloud synchronization failed.');
    }finally{setBusy(false);}
  }

  async function restore(){
    if(!enabled)return;
    setBusy(true);setStatus('');
    try{
      const remote=await readCloudSnapshot(key);
      if(!Number.isSafeInteger(remote.revision)||remote.revision<1)
        throw Error('Cloud revision missing. Apply migration 0002_sync_revision.sql.');
      const data=readBackup(await decryptBackup(remote.encrypted,passphrase));
      if(!window.confirm('Restore cloud revision '+remote.revision+' from '+remote.updatedAt+
        '? This REPLACES all local HTTP/gRPC requests, collections and environments. Export a JSON backup first.'))return;
      if(!data.collections.length){
        const col:Collection={id:newId(),name:'Restored collection',createdAt:Date.now()};
        data.collections=[col];
        data.requests=data.requests.map(item=>({...item,collectionId:item.collectionId||col.id}));
        data.grpcRequests=data.grpcRequests.map(item=>({...item,collectionId:item.collectionId||col.id}));
      }
      await db.transaction('rw',db.requests,db.environments,db.collections,db.folders,db.grpcRequests,db.syncBase,async()=>{
        await Promise.all([db.requests.clear(),db.environments.clear(),db.collections.clear(),
          db.folders.clear(),db.grpcRequests.clear()]);
        await db.collections.bulkPut(data.collections);await db.folders.bulkPut(data.folders);
        await db.requests.bulkPut(data.requests);await db.grpcRequests.bulkPut(data.grpcRequests);
        await db.environments.bulkPut(data.environments);
        await db.syncBase.put({id:'default',revision:remote.revision,encrypted:remote.encrypted});
      });
      resetPreview();onApplied(data);
      setStatus('Restored cloud revision '+remote.revision+'. The encrypted sync baseline is updated.');
    }catch(error){setStatus(error instanceof Error?error.message:'Cloud restore failed.');}
    finally{setBusy(false);}
  }

  const unresolved=preview?.conflicts.filter(conflict=>!choices[conflict.key]).length||0;
  const merged=preview?mergeWorkspace(preview.base,preview.local,preview.remote,choices):null;

  return <div className="sync-panel">
    <div className="proxy-info"><ShieldAlert size={18}/><div>
      <strong>Encrypted multi-device workspace sync</strong>
      <p>Your browser decrypts and merges data. Cloudflare D1 stores ciphertext and an atomic revision counter; concurrent writes cannot silently overwrite one another.</p>
    </div></div>
    <label className="field-label">Server sync key</label>
    <input className="form-input" aria-label="Server sync key" type="password" autoComplete="off"
      value={key} onChange={event=>{setKey(event.target.value);resetPreview();}}
      placeholder="REQDOCK_SYNC_KEY"/>
    <label className="field-label">Encryption passphrase (12+ characters)</label>
    <input className="form-input" aria-label="Encryption passphrase" type="password" autoComplete="off"
      value={passphrase} onChange={event=>{setPassphrase(event.target.value);resetPreview();}}
      placeholder="Private encryption passphrase"/>
    <p className="modal-note">First sync on a device conservatively combines both sides. Later syncs use a locally stored encrypted baseline to detect edits and deletions. Neither key nor passphrase is saved. Apply D1 migration <code>0002_sync_revision.sql</code>.</p>

    {preview&&merged&&<div className="sync-preview" aria-label="Cloud sync review">
      <strong>Review cloud revision {preview.revision}</strong>
      <p className="modal-note">{preview.bootstrap?'This device has no common baseline. Both sides are treated as additions, so no deletions can be inferred. ':''}
        Local: {preview.local.requests.length} HTTP / {preview.local.grpcRequests.length} gRPC.
        Cloud: {preview.remote.requests.length} HTTP / {preview.remote.grpcRequests.length} gRPC.
        Merged: {merged.workspace.requests.length} HTTP / {merged.workspace.grpcRequests.length} gRPC.
      </p>
      <p className="modal-note">{preview.conflicts.length} conflicting record(s). {merged.resurrected>0?
        String(merged.resurrected)+' referenced collections/folders are retained to avoid dangling items.':''}</p>
      {preview.conflicts.map(conflict=><div className="sync-conflict" key={conflict.key}>
        <div><strong>{conflict.field} · {conflict.name}</strong><small>{conflict.reason}</small></div>
        <select className="form-input" aria-label={'Resolve '+conflict.field+' '+conflict.name}
          value={choices[conflict.key]||''} onChange={event=>setChoices(old=>({...old,[conflict.key]:event.target.value as Resolution}))}>
          <option value="">Choose version…</option>
          <option value="local">Keep local</option>
          <option value="remote">Keep cloud</option>
        </select>
      </div>)}
      <button className="button primary" disabled={!enabled||unresolved>0} onClick={()=>void apply()}>
        <Check size={14}/> Confirm synchronized merge
      </button>
    </div>}
    {status&&<p className="sync-status" role="status">{status}</p>}
    <div className="modal-footer">
      <button className="button outlined" disabled={!enabled} onClick={()=>void restore()}>
        <Download size={14}/> Restore cloud (replace local)
      </button>
      <button className="button primary" disabled={!enabled} onClick={()=>void review()}>
        <Cloud size={14}/> {busy?'Working…':'Review sync changes'}
      </button>
    </div>
  </div>;
}
