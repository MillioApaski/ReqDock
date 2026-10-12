import { describe, expect, it } from 'vitest';
import { encryptBackup, decryptBackup } from '../src/lib/sync';
import { webcrypto } from 'node:crypto';
// Node.js WebCrypto follows browser SubtleCrypto behavior.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
describe('encrypted D1 backups', () => {
  it('roundtrips private workspace data without exposing tokens', async () => {
    const data = { version: 2, requests: [{ token: 'sensitive-token' }], environments: [], collections: [], folders: [] };
    const envelope = await encryptBackup(data, 'correct horse battery staple');
    expect(JSON.stringify(envelope)).not.toContain('sensitive-token');
    expect(await decryptBackup(envelope, 'correct horse battery staple')).toEqual(data);
    await expect(decryptBackup(envelope, 'wrong passphrase here')).rejects.toThrow('Unable to decrypt');
  });
  it('detects tampering and rejects short passphrases', async () => {
    await expect(encryptBackup({}, 'short')).rejects.toThrow('12 characters');
    const envelope = await encryptBackup({ ok: true }, 'a sufficiently long passphrase');
    const next = { ...envelope, ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1) };
    await expect(decryptBackup(next, 'a sufficiently long passphrase')).rejects.toThrow('Unable to decrypt');
  });
});
