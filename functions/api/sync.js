/** Optional Cloudflare D1 encrypted backup endpoint. Disabled without BOTH bindings. */
const LIMIT = 1024 * 1024;
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function fail(status, message) { return Response.json({ error: message }, { status, headers: noStore }); }
function authorized({ request, env }) {
  if (!env.REQDOCK_DB || !env.REQDOCK_SYNC_KEY) return fail(503, 'Cloud sync is disabled. Configure REQDOCK_DB and REQDOCK_SYNC_KEY.');
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return fail(403, 'Requests must come from this origin.');
  const a = request.headers.get('X-ReqDock-Sync-Key') || '';
  const b = env.REQDOCK_SYNC_KEY;
  // Equal-length constant-time comparison. Unauthorized clients must not learn configuration.
  if (a.length !== b.length) return fail(401, 'Invalid sync key.');
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (mismatch) return fail(401, 'Invalid sync key.');
  return null;
}
async function readBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > LIMIT) throw new Error('SIZE_LIMIT');
  if (!request.body) throw new Error('EMPTY');
  const reader = request.body.getReader(); const chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > LIMIT) throw new Error('SIZE_LIMIT');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(total); let i = 0;
  for (const chunk of chunks) { joined.set(chunk, i); i += chunk.length; }
  return JSON.parse(new TextDecoder().decode(joined));
}
function validateEncryptedShape(value) {
  return value && typeof value === 'object' && value.version === 1 &&
    ['salt','iv','ciphertext'].every(k => typeof value[k] === 'string' && value[k].length > 0) &&
    value.salt.length < 128 && value.iv.length < 128 && value.ciphertext.length < LIMIT &&
    /^[A-Za-z0-9+/=]+$/.test(value.salt) && /^[A-Za-z0-9+/=]+$/.test(value.iv) && /^[A-Za-z0-9+/=]+$/.test(value.ciphertext);
}
export async function onRequest({ request, env }) {
  const denied = authorized({ request, env }); if (denied) return denied;
  if (request.method === 'GET') {
    try {
      const record = await env.REQDOCK_DB.prepare('SELECT data, updated_at FROM reqdock_snapshots WHERE id=?').bind('default').first();
      if (!record) return fail(404, 'No encrypted snapshot has been uploaded.');
      return Response.json({ encrypted: JSON.parse(record.data), updatedAt: record.updated_at }, { headers: noStore });
    } catch { return fail(500, 'Cloud storage is unavailable or has not been migrated.'); }
  }
  if (request.method === 'PUT') {
    let encrypted;
    try { encrypted = await readBody(request); }
    catch (error) { return fail(error.message === 'SIZE_LIMIT' ? 413 : 400, 'Invalid or oversized encrypted snapshot.'); }
    if (!validateEncryptedShape(encrypted)) return fail(400, 'Expected an encrypted workspace envelope.');
    try {
      await env.REQDOCK_DB.prepare('INSERT INTO reqdock_snapshots (id,data,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
        .bind('default', JSON.stringify(encrypted), new Date().toISOString()).run();
      return Response.json({ ok: true }, { headers: noStore });
    } catch { return fail(500, 'Could not store the encrypted snapshot.'); }
  }
  return fail(405, 'Method not allowed.');
}
