import { db } from './storage';
import { decryptBackup, encryptBackup, optionalCloudSnapshot, writeCloudSnapshot, CloudVersionConflict } from './sync';
import { readBackup } from './export';
import { emptyWorkspace, mergeWorkspace, type Workspace } from './workspace-merge';

export type AutoSyncState='watching'|'synced'|'updated'|'conflict'|'deferred'|'error';
export type AutoSyncResult={
  state:AutoSyncState; message:string; cloudRevision?:number; applied?:Workspace;
};

const fields=['requests','environments','collections','folders','grpcRequests'] as const;

/** Ignore entity ordering, but never ignore edits within an entity. */
export function workspaceFingerprint(workspace:Workspace):string {
  const sorted:Record<string,unknown>={};
  for(const field of fields)sorted[field]=[...workspace[field]].sort((a,b)=>a.id.localeCompare(b.id));
  return JSON.stringify(sorted);
}
export async function loadWorkspace():Promise<Workspace> {
  return {
    requests:await db.requests.toArray(),environments:await db.environments.toArray(),
    collections:await db.collections.toArray(),folders:await db.folders.toArray(),
    grpcRequests:await db.grpcRequests.toArray(),
  };
}

/**
 * Explicit opt-in, in-memory tab session. Does not silently choose either
 * side of a conflict. Atomic CAS and IndexedDB transaction protect writes.
 *
 * isSafeToApply must verify the editor has no unsaved in-memory changes.
 */
export async function syncAutomatically(key:string,passphrase:string,
  isSafeToApply:()=>Promise<boolean>):Promise<AutoSyncResult>{
  if(!await isSafeToApply())return {state:'deferred',message:'Auto sync paused until the request editor is safely saved.'};
  const local=await loadWorkspace();
  const cloud=await optionalCloudSnapshot(key);
  const revision=cloud?.revision||0;
  const baseline=await db.syncBase.get('default');
  if(baseline&&baseline.revision>revision)
    return {state:'error',message:'Cloud revision was reset or rolled back. Manual review required.'};
  const base=baseline?readBackup(await decryptBackup(baseline.encrypted,passphrase)):emptyWorkspace();
  const remote=cloud?readBackup(await decryptBackup(cloud.encrypted,passphrase)):emptyWorkspace();
  const outcome=mergeWorkspace(base,local,remote);
  if(outcome.conflicts.length||outcome.unresolved)
    return {state:'conflict',message:outcome.conflicts.length+' conflicting records require a manual decision.',cloudRevision:revision};
  const localHash=workspaceFingerprint(local);
  const mergedHash=workspaceFingerprint(outcome.workspace);
  const remoteHash=workspaceFingerprint(remote);
  // A remote-only update already exists in D1: apply it locally without
  // publishing identical content as another revision.
  const mustWrite=mergedHash!==remoteHash;
  // Identical local/cloud data never creates a throwaway cloud revision.
  if(!cloud && !mustWrite)return {state:'watching',message:'No workspace snapshot to synchronize yet.',cloudRevision:0};
  let encrypted=cloud?.encrypted;
  let savedRevision=revision;
  if(mustWrite){
    encrypted=await encryptBackup({version:3,...outcome.workspace},passphrase);
    try{
      const saved=await writeCloudSnapshot(encrypted,key,revision);
      savedRevision=saved.revision;
    }catch(error){
      if(error instanceof CloudVersionConflict)
        return {state:'conflict',message:'Another device updated the cloud during auto sync. Review changes manually.',cloudRevision:revision};
      throw error;
    }
  }
  if(!encrypted)return {state:'watching',message:'Cloud is empty.',cloudRevision:0};
  let applied=false,dirty=false;
  await db.transaction('rw',[db.requests,db.environments,db.collections,db.folders,db.grpcRequests,db.syncBase],async()=>{
    const latest=await loadWorkspace();
    // Never replace in-flight edits. Store the cloud baseline so a later check
    // can merge the new unsynced local edits against the committed cloud value.
    dirty=workspaceFingerprint(latest)!==localHash||!await isSafeToApply();
    if(!dirty&&mergedHash!==localHash){
      await Promise.all([db.requests.clear(),db.environments.clear(),db.collections.clear(),
        db.folders.clear(),db.grpcRequests.clear()]);
      await db.collections.bulkPut(outcome.workspace.collections);
      await db.folders.bulkPut(outcome.workspace.folders);
      await db.requests.bulkPut(outcome.workspace.requests);
      await db.grpcRequests.bulkPut(outcome.workspace.grpcRequests);
      await db.environments.bulkPut(outcome.workspace.environments);
      applied=true;
    }
    await db.syncBase.put({id:'default',revision:savedRevision,encrypted});
  });
  if(dirty)return {state:'deferred',message:'Cloud revision '+savedRevision+
    ' saved, but newer local edits were preserved. Waiting for next check.',cloudRevision:savedRevision};
  return {
    state:applied?'updated':'synced',
    message:applied?'Auto sync applied cloud changes (revision '+savedRevision+').'
      :'Auto sync is current at revision '+savedRevision+'.',
    cloudRevision:savedRevision,applied:applied?outcome.workspace:undefined,
  };
}
