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
export async function writeCloudSnapshot(encrypted: EncryptedSnapshot, key: string): Promise<void> {
  const res = await fetch('/api/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-ReqDock-Sync-Key': key }, body: JSON.stringify(encrypted), cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json() as { error?: string }).error || `Cloud sync returned ${res.status}`);
}
export async function readCloudSnapshot(key: string): Promise<{ encrypted: EncryptedSnapshot; updatedAt: string }> {
  const res = await fetch('/api/sync', { headers: { 'X-ReqDock-Sync-Key': key }, cache: 'no-store' });
  const json = await res.json() as { encrypted: EncryptedSnapshot; updatedAt: string; error?: string };
  if (!res.ok) throw new Error(json.error || `Cloud sync returned ${res.status}`);
  return json;
}
