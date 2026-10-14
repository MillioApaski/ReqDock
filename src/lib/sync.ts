export type EncryptedSnapshot = { version: 1; salt: string; iv: string; ciphertext: string };
const encode = (bytes: Uint8Array): string => {
  let chunks = '';
  for (let i = 0; i < bytes.length; i += 0x4000) chunks += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return btoa(chunks);
};
const decode = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const keyFrom = async (passphrase: string, salt: Uint8Array<ArrayBuffer>) => {
  if (passphrase.length < 12) throw new Error('Encryption passphrase must be at least 12 characters.');
  const root = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};
export async function encryptBackup(value: unknown, passphrase: string): Promise<EncryptedSnapshot> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt);
  const payload = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return { version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) };
}
export async function decryptBackup(value: EncryptedSnapshot, passphrase: string): Promise<unknown> {
  if (!value || value.version !== 1 || typeof value.ciphertext !== 'string') throw new Error('Invalid encrypted backup format.');
  try {
    const salt = decode(value.salt), iv = decode(value.iv), ciphertext = decode(value.ciphertext);
    if (salt.byteLength !== 16 || iv.byteLength !== 12) throw new Error('Bad encryption parameters');
    const key = await keyFrom(passphrase, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { throw new Error('Unable to decrypt snapshot. Check the passphrase and data integrity.'); }
}
export type CloudSnapshot = { encrypted:EncryptedSnapshot; updatedAt:string; revision:number };
export class CloudVersionConflict extends Error {
  constructor(){super('Cloud data changed. Fetch the latest snapshot and review conflicts again.');this.name='CloudVersionConflict';}
}
export async function writeCloudSnapshot(encrypted: EncryptedSnapshot, key: string, expectedRevision: number): Promise<{revision:number;updatedAt:string}> {
  const res = await fetch('/api/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-ReqDock-Sync-Key': key }, body: JSON.stringify({encrypted,expectedRevision}), cache: 'no-store' });
  if (res.status === 409) throw new CloudVersionConflict();
  if (!res.ok) throw new Error((await res.json() as { error?: string }).error || `Cloud sync returned ${res.status}`);
  return await res.json() as {revision:number;updatedAt:string};
}
export async function readCloudSnapshot(key: string): Promise<CloudSnapshot> {
  const res = await fetch('/api/sync', { headers: { 'X-ReqDock-Sync-Key': key }, cache: 'no-store' });
  const json = await res.json() as CloudSnapshot & { error?: string };
  if (!res.ok) throw new Error(json.error || `Cloud sync returned ${res.status}`);
  return json;
}


/** A missing workspace (404) is an unsynchronized server at revision zero. */
export async function optionalCloudSnapshot(key:string):Promise<CloudSnapshot|null>{
  const res=await fetch('/api/sync',{headers:{'X-ReqDock-Sync-Key':key},cache:'no-store'});
  if(res.status===404)return null;
  const data=await res.json() as CloudSnapshot & {error?:string};
  if(!res.ok)throw Error(data.error||'Cloud sync returned '+res.status);
  if(!Number.isSafeInteger(data.revision)||data.revision<1)throw Error('Cloud revision missing. Apply migration 0002_sync_revision.sql.');
  return data;
}


export type CloudHistoryEntry = { revision:number; updatedAt:string };

/** History list contains revision metadata only, never decrypted workspace data. */
export async function listCloudHistory(key:string):Promise<CloudHistoryEntry[]> {
  const response=await fetch('/api/sync?history=1',{
    headers:{'X-ReqDock-Sync-Key':key},cache:'no-store',
  });
  const body=await response.json() as {history?:CloudHistoryEntry[];error?:string};
  if(!response.ok)throw Error(body.error||'Cloud history returned '+response.status);
  if(!Array.isArray(body.history))throw Error('Invalid cloud history response.');
  if(body.history.length>20 || body.history.some(entry=>!Number.isSafeInteger(entry.revision)||
    entry.revision<1||typeof entry.updatedAt!=='string'))throw Error('Invalid cloud history entries.');
  return body.history;
}

/** The snapshot is still AES-GCM ciphertext; caller must authenticate/decrypt locally. */
export async function readCloudHistoryRevision(key:string,revision:number):Promise<CloudSnapshot> {
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('Invalid history revision.');
  const response=await fetch('/api/sync?revision='+revision,{
    headers:{'X-ReqDock-Sync-Key':key},cache:'no-store',
  });
  const body=await response.json() as CloudSnapshot & {error?:string};
  if(!response.ok)throw Error(body.error||'Cloud history returned '+response.status);
  if(body.revision!==revision||!body.encrypted)throw Error('Cloud history revision mismatch.');
  return body;
}
