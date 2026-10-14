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
    const url = new URL(request.url);
    const list = url.searchParams.get('history');
    const wanted = url.searchParams.get('revision');
    if ((list !== null && list !== '1') || (list !== null && wanted !== null))
      return fail(400, 'Specify either history=1 or a positive revision.');
    if (wanted !== null && (!/^[1-9][0-9]{0,14}$/.test(wanted) || !Number.isSafeInteger(Number(wanted))))
      return fail(400, 'Invalid cloud history revision.');
    if (list === '1') {
      try {
        const result = await env.REQDOCK_DB.prepare(
          'SELECT revision,updated_at FROM reqdock_snapshot_history WHERE snapshot_id=? ORDER BY revision DESC LIMIT 20',
        ).bind('default').all();
        return Response.json({
          history: (result.results || []).map(row => ({
            revision: row.revision, updatedAt: row.updated_at,
          })),
        }, { headers: noStore });
      } catch { return fail(500, 'Cloud history unavailable. Apply migration 0003_sync_history.sql.'); }
    }
    if (wanted !== null) {
      try {
        const record = await env.REQDOCK_DB.prepare(
          'SELECT data,updated_at,revision FROM reqdock_snapshot_history WHERE snapshot_id=? AND revision=?',
        ).bind('default', Number(wanted)).first();
        if (!record) return fail(404, 'Requested encrypted history revision is unavailable.');
        return Response.json({
          encrypted: JSON.parse(record.data), updatedAt: record.updated_at, revision: record.revision,
        }, { headers: noStore });
      } catch { return fail(500, 'Cloud history unavailable. Apply migration 0003_sync_history.sql.'); }
    }
    try {
      const record = await env.REQDOCK_DB.prepare(
        'SELECT data,updated_at,revision FROM reqdock_snapshots WHERE id=?',
      ).bind('default').first();
      if (!record) return fail(404, 'No encrypted snapshot has been uploaded.');
      return Response.json({
        encrypted: JSON.parse(record.data), updatedAt: record.updated_at, revision: record.revision,
      }, { headers: noStore });
    } catch { return fail(500, 'Cloud storage unavailable. Apply migration 0002_sync_revision.sql.'); }
  }
  if (request.method === 'PUT') {
    let body;
    try { body = await readBody(request); }
    catch (error) { return fail(error.message === 'SIZE_LIMIT' ? 413 : 400, 'Invalid or oversized encrypted snapshot.'); }
    // Legacy blind-overwrite clients MUST NOT be allowed to clobber a newer device.
    if (!body || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
      return fail(428, 'Expected a nonnegative expectedRevision; upgrade ReqDock before uploading.');
    if (!validateEncryptedShape(body.encrypted)) return fail(400, 'Expected an encrypted workspace envelope.');
    try {
      const encoded = JSON.stringify(body.encrypted), now = new Date().toISOString();
      let updated;
      if (body.expectedRevision === 0) {
        updated = await env.REQDOCK_DB.prepare(
          'INSERT INTO reqdock_snapshots (id,data,updated_at,revision) VALUES (?,?,?,1) ON CONFLICT(id) DO NOTHING RETURNING revision',
        ).bind('default', encoded, now).first();
      } else {
        updated = await env.REQDOCK_DB.prepare(
          'UPDATE reqdock_snapshots SET data=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? RETURNING revision',
        ).bind(encoded, now, 'default', body.expectedRevision).first();
      }
      // A single SQL write/RETURNING is atomic under concurrent D1 requests.
      if (!updated) return fail(409, 'Cloud snapshot changed since your last read. Reload and merge again.');
      return Response.json({ ok: true, revision: updated.revision, updatedAt: now }, { headers: noStore });
    } catch { return fail(500, 'Cloud storage unavailable. Apply migration 0002_sync_revision.sql.'); }
  }
  return fail(405, 'Method not allowed.');
}
