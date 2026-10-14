import { useEffect, useRef, useState } from 'react';
import { Check, Cloud, Download, ShieldAlert, History, RotateCcw } from 'lucide-react';
import { db } from '../lib/storage';
import { encryptBackup, decryptBackup, optionalCloudSnapshot, readCloudSnapshot,
  writeCloudSnapshot, CloudVersionConflict, listCloudHistory, readCloudHistoryRevision,
  type CloudHistoryEntry, type CloudSnapshot } from '../lib/sync';
import { readBackup } from '../lib/export';
import { emptyWorkspace, mergeWorkspace, type Workspace, type Conflict, type Resolution } from '../lib/workspace-merge';
import { newId, type Collection } from '../types';
import { syncAutomatically, type AutoSyncState } from '../lib/auto-sync';

type Preview = {
  local:Workspace; remote:Workspace; base:Workspace; revision:number;
  bootstrap:boolean; conflicts:Conflict[];
};
type HistoryPreview = {
  snapshot:CloudSnapshot; data:Workspace; local:Workspace; expectedRevision:number;
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

export type SyncIndicator={state:AutoSyncState|'off';message:string};
export function SyncPanel({onApplied,onWatchStatus,canAutoApply,isOpen}:{
  onApplied:(data:Workspace)=>void;
  onWatchStatus:(state:SyncIndicator)=>void;
  canAutoApply:()=>Promise<boolean>;
  isOpen:boolean;
}){
  const [key,setKey]=useState('');
  const [passphrase,setPassphrase]=useState('');
  const [busy,setBusy]=useState(false);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [choices,setChoices]=useState<Record<string,Resolution>>({});
  const [status,setStatus]=useState('');
  const [historyEntries,setHistoryEntries]=useState<CloudHistoryEntry[]>([]);
  const [historyLoaded,setHistoryLoaded]=useState(false);
  const [historyPreview,setHistoryPreview]=useState<HistoryPreview|null>(null);
  const [autoEnabled,setAutoEnabled]=useState(false);
  const [autoStatus,setAutoStatus]=useState<SyncIndicator>({
    state:'off',message:'Session auto sync is disabled.',
  });
  const polling=useRef(false);
  const onAppliedRef=useRef(onApplied);
  const onStatusRef=useRef(onWatchStatus);
  const canApplyRef=useRef(canAutoApply);
  onAppliedRef.current=onApplied;
  onStatusRef.current=onWatchStatus;
  canApplyRef.current=canAutoApply;
  const statusUpdate=(state:SyncIndicator)=>{
    setAutoStatus(state);
    onStatusRef.current(state);
  };
  const previousOpen=useRef(isOpen);
  useEffect(()=>{
    if(previousOpen.current&&!isOpen&&!autoEnabled){
      setKey('');setPassphrase('');setPreview(null);setChoices({});
      setHistoryEntries([]);setHistoryLoaded(false);setHistoryPreview(null);
    }
    previousOpen.current=isOpen;
  },[isOpen,autoEnabled]);
  useEffect(()=>{
    if(!autoEnabled) return;
    let disposed=false;
    const poll=async()=>{
      if(disposed||polling.current||isOpen||document.visibilityState!=='visible')return;
      polling.current=true;
      try{
        if(!await canApplyRef.current()){
          if(!disposed)statusUpdate({state:'deferred',message:'Waiting for unfinished edits or dialogs to close.'});
          return;
        }
        if(!disposed)statusUpdate({state:'watching',message:'Checking encrypted cloud workspace…'});
        const result=await syncAutomatically(key,passphrase,canApplyRef.current);
        if(disposed)return;
        if(result.applied)onAppliedRef.current(result.applied);
        statusUpdate({state:result.state,message:result.message});
        if(result.state==='conflict'||result.state==='error'){
          setAutoEnabled(false);
          // The session remains unpersisted and requires explicit review.
        }
      }catch(error){
        if(!disposed){
          statusUpdate({state:'error',message:error instanceof Error?error.message:'Auto sync failed.'});
          setAutoEnabled(false);
        }
      }finally{polling.current=false;}
    };
    const timer=window.setInterval(()=>void poll(),60000);
    const checkOnFocus=()=>void poll();
    window.addEventListener('focus',checkOnFocus);
    document.addEventListener('visibilitychange',checkOnFocus);
    if(!isOpen)void poll();
    return ()=>{
      disposed=true;
      window.clearInterval(timer);
      window.removeEventListener('focus',checkOnFocus);
      document.removeEventListener('visibilitychange',checkOnFocus);
    };
  },[autoEnabled,isOpen,key,passphrase]);
  const enabled=!!key&&passphrase.length>=12&&!busy;
  const resetPreview=()=>{setPreview(null);setChoices({});};
  const clearHistory=()=>{setHistoryEntries([]);setHistoryLoaded(false);setHistoryPreview(null);};
  const stopAutomatic=()=>{
    setAutoEnabled(false);
    statusUpdate({state:'off',message:'Session auto sync stopped. Credentials are not stored.'});
  };
  const startAutomatic=()=>{
    if(!enabled)return;
    setAutoEnabled(true);
    statusUpdate({state:'watching',message:'Session auto sync is on. Checking once per minute while this tab is active.'});
  };

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
      await db.transaction('rw',[db.requests,db.environments,db.collections,db.folders,db.grpcRequests,db.syncBase],async()=>{
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
      resetPreview();clearHistory();
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
      await db.transaction('rw',[db.requests,db.environments,db.collections,db.folders,db.grpcRequests,db.syncBase],async()=>{
        await Promise.all([db.requests.clear(),db.environments.clear(),db.collections.clear(),
          db.folders.clear(),db.grpcRequests.clear()]);
        await db.collections.bulkPut(data.collections);await db.folders.bulkPut(data.folders);
        await db.requests.bulkPut(data.requests);await db.grpcRequests.bulkPut(data.grpcRequests);
        await db.environments.bulkPut(data.environments);
        await db.syncBase.put({id:'default',revision:remote.revision,encrypted:remote.encrypted});
      });
      resetPreview();clearHistory();onApplied(data);
      setStatus('Restored cloud revision '+remote.revision+'. The encrypted sync baseline is updated.');
    }catch(error){setStatus(error instanceof Error?error.message:'Cloud restore failed.');}
    finally{setBusy(false);}
  }

  async function loadHistory() {
    if(!enabled)return;
    setBusy(true);setHistoryPreview(null);setStatus('');
    try {
      const entries=await listCloudHistory(key);
      setHistoryEntries(entries);setHistoryLoaded(true);
      setStatus(entries.length?'Select a version to inspect before restoring.':'No historical versions are available yet.');
    } catch(error) {
      clearHistory();
      setStatus(error instanceof Error?error.message:'Could not list encrypted cloud history.');
    } finally {setBusy(false);}
  }
  async function previewHistory(revision:number) {
    if(!enabled)return;
    setBusy(true);setHistoryPreview(null);setStatus('');
    try {
      const [latest,snapshot]=await Promise.all([
        optionalCloudSnapshot(key),readCloudHistoryRevision(key,revision),
      ]);
      if(!latest)throw Error('The latest cloud snapshot is unavailable. Refresh history.');
      if(snapshot.revision>latest.revision)throw Error('History revision is newer than the cloud head.');
      const data=readBackup(await decryptBackup(snapshot.encrypted,passphrase));
      const local=await loadLocal();
      setHistoryPreview({snapshot,data,local,expectedRevision:latest.revision});
      setStatus('Version '+revision+' decrypted locally. Review the counts before restoring.');
    } catch(error) {
      setStatus(error instanceof Error?error.message:'Could not inspect history revision.');
    } finally {setBusy(false);}
  }
  async function restoreHistorical() {
    if(!enabled||!historyPreview)return;
    const plan=historyPreview;
    if(!window.confirm(
      'Restore historical revision '+plan.snapshot.revision+' as NEW cloud revision '+
      (plan.expectedRevision+1)+'? This replaces the local workspace if unchanged and makes this historical content current across devices. Export a JSON backup first.'
    ))return;
    setBusy(true);setStatus('');
    try{
      const latest=await loadLocal();
      if(fingerprint(latest)!==fingerprint(plan.local))
        throw Error('Local workspace changed while reviewing history. Refresh the preview.');
      // The original encrypted envelope is uploaded unchanged. No plaintext
      // history ever passes through Cloudflare and the CAS never goes backwards.
      const saved=await writeCloudSnapshot(plan.snapshot.encrypted,key,plan.expectedRevision);
      let replaced=false;
      await db.transaction('rw',[db.requests,db.environments,db.collections,db.folders,db.grpcRequests,db.syncBase],async()=>{
        const current:Workspace={
          requests:await db.requests.toArray(),environments:await db.environments.toArray(),
          collections:await db.collections.toArray(),folders:await db.folders.toArray(),
          grpcRequests:await db.grpcRequests.toArray(),
        };
        if(fingerprint(current)===fingerprint(plan.local)){
          await Promise.all([db.requests.clear(),db.environments.clear(),db.collections.clear(),
            db.folders.clear(),db.grpcRequests.clear()]);
          await db.collections.bulkPut(plan.data.collections);
          await db.folders.bulkPut(plan.data.folders);
          await db.requests.bulkPut(plan.data.requests);
          await db.grpcRequests.bulkPut(plan.data.grpcRequests);
          await db.environments.bulkPut(plan.data.environments);
          replaced=true;
        }
        await db.syncBase.put({
          id:'default',revision:saved.revision,encrypted:plan.snapshot.encrypted,
        });
      });
      clearHistory();resetPreview();
      if(replaced){
        onApplied(plan.data);
        setStatus('Restored historical revision '+plan.snapshot.revision+
          ' as new cloud revision '+saved.revision+'.');
      }else{
        setStatus('Historical revision now saved as cloud revision '+saved.revision+
          ', but concurrent local edits were preserved. Review sync changes to reconcile them.');
      }
    }catch(error){
      if(error instanceof CloudVersionConflict){
        setHistoryPreview(null);
        setStatus('Another device updated the cloud. Refresh history before attempting rollback again.');
      }else{
        setStatus(error instanceof Error?error.message:'Unable to restore historical revision.');
      }
    }finally{setBusy(false);}
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
      value={key} onChange={event=>{if(autoEnabled)stopAutomatic();setKey(event.target.value);resetPreview();clearHistory();}}
      placeholder="REQDOCK_SYNC_KEY"/>
    <label className="field-label">Encryption passphrase (12+ characters)</label>
    <input className="form-input" aria-label="Encryption passphrase" type="password" autoComplete="off"
      value={passphrase} onChange={event=>{if(autoEnabled)stopAutomatic();setPassphrase(event.target.value);resetPreview();clearHistory();}}
      placeholder="Private encryption passphrase"/>
    <p className="modal-note">First sync conservatively combines both sides; later syncs use your encrypted baseline for change detection. Credentials stay only in memory. Apply D1 migrations 0002 and 0003 before testing the deployed cloud features.</p>
    <div className="sync-automation" aria-label="Session automatic sync">
      <div><strong>Automatic sync in this tab</strong>
        <p className="modal-note">Optional. Checks about every 60 seconds and when returning to the tab. Applies conflict-free updates; never chooses between conflicting edits. Pauses for unsaved edits, hidden tabs and open dialogs. Stops on conflicts or errors. Nothing runs after closing this browser tab.</p>
      </div>
      <button className={autoEnabled?'button outlined':'button primary'} disabled={!autoEnabled&&!enabled}
        onClick={autoEnabled?stopAutomatic:startAutomatic}>
        {autoEnabled?'Stop auto sync':'Enable auto sync'}
      </button>
      <p className="sync-status" role="status">{autoStatus.message}</p>
    </div>

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
    <div className="sync-history-section">
      <div className="sync-history-heading">
        <strong><History size={15}/> Cloud revision history</strong>
        <button className="button outlined" disabled={!enabled} onClick={()=>void loadHistory()}>
          <History size={14}/> {busy?'Working…':'List history'}
        </button>
      </div>
      <p className="modal-note">The most recent 20 encrypted snapshots are retained. Restoring a historical revision creates a NEW cloud revision and replaces local data only after confirmation.</p>
      {historyLoaded&&<div className="sync-history-list" aria-label="Cloud history versions">
        {historyEntries.map(entry=><div className="sync-history-entry" key={entry.revision}>
          <div><strong>Revision {entry.revision}</strong><small>{entry.updatedAt}</small></div>
          <button className="button outlined" disabled={!enabled}
            onClick={()=>void previewHistory(entry.revision)}>Inspect</button>
        </div>)}
        {!historyEntries.length&&<p className="modal-note">No stored revisions yet.</p>}
      </div>}
      {historyPreview&&<div className="sync-history-preview" aria-label="Historical restore preview">
        <strong>Revision {historyPreview.snapshot.revision} · {historyPreview.snapshot.updatedAt}</strong>
        <p className="modal-note">HTTP: {historyPreview.data.requests.length} · gRPC: {historyPreview.data.grpcRequests.length} · Collections: {historyPreview.data.collections.length} · Environments: {historyPreview.data.environments.length}</p>
        <p className="modal-note">Current cloud revision: {historyPreview.expectedRevision}. Recovery publishes a new revision, never rewinds the counter.</p>
        <button className="button outlined danger" disabled={!enabled} onClick={()=>void restoreHistorical()}>
          <RotateCcw size={14}/> Restore as new revision
        </button>
      </div>}
    </div>
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
