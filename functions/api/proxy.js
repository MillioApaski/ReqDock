/**
 * Cloudflare Pages Functions proxy. Disabled unless both an exact host allowlist
 * and a secret proxy key are configured. Never deploy as an unrestricted relay.
 * Supported: text request bodies, binary/text responses up to 2 MiB.
 */
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const BLOCKED = /^(host|connection|content-length|transfer-encoding|upgrade|keep-alive|te|trailer|proxy-.*|cf-.*|x-forwarded-.*|sec-.*)$/i;

function fail(status, error) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function hostAllowed(hostname, allowlist) {
  return allowlist.split(',').map(s => s.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean).includes(hostname.toLowerCase().replace(/\.$/, ''));
}
function isIpOrPrivateHost(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') ||
    hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^\d+$/.test(hostname);
}
function isText(contentType) {
  return /^(text\/|application\/(json|xml|graphql|javascript|problem\+json|[^;]+\+json|[^;]+\+xml))|image\/svg\+xml/i.test(contentType) || !contentType;
}
async function limitedBytes(stream, maximum) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel('Preview size limit exceeded'); throw new Error('SIZE_LIMIT'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
function base64(bytes) {
  let result = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 16384) result += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(result);
}
export async function onRequestPost({ request, env }) {
  const allowlist = env.REQDOCK_ALLOWED_HOSTS || '';
  const secret = env.REQDOCK_PROXY_KEY || '';
  if (!allowlist.trim() || !secret) return fail(503, 'Proxy is disabled. Configure REQDOCK_ALLOWED_HOSTS and REQDOCK_PROXY_KEY in Cloudflare Pages settings.');
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return fail(403, 'Cross-origin proxy access is not allowed.');
  if (request.headers.get('X-ReqDock-Proxy-Key') !== secret) return fail(401, 'Invalid proxy key.');
  const declaredSize = Number(request.headers.get('Content-Length') || 0);
  if (declaredSize > MAX_REQUEST_BYTES) return fail(413, 'Request exceeds the 1 MiB proxy limit.');
  let payload;
  try {
    const bytes = await limitedBytes(request.body, MAX_REQUEST_BYTES);
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) { return fail(error.message === 'SIZE_LIMIT' ? 413 : 400, 'Invalid or oversized request payload.'); }
  if (!payload || typeof payload !== 'object' || typeof payload.url !== 'string') return fail(400, 'A request URL is required.');
  let url;
  try { url = new URL(payload.url); } catch { return fail(400, 'Invalid request URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isIpOrPrivateHost(url.hostname) ||
      !hostAllowed(url.hostname, allowlist) || url.hostname.toLowerCase() === new URL(request.url).hostname.toLowerCase()) {
    return fail(403, 'Target host is not allowed. Only explicitly allowlisted public DNS hostnames are supported.');
  }
  if (url.port && !((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80'))) {
    return fail(403, 'Nonstandard ports are not supported by this proxy.');
  }
  const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'GET';
  if (!METHODS.has(method)) return fail(400, 'Unsupported HTTP method.');
  if (payload.body !== undefined && typeof payload.body !== 'string') return fail(400, 'Body must be UTF-8 text.');
  if (payload.multipart && (!Array.isArray(payload.multipart.fields) || payload.multipart.fields.length > 100 || !payload.multipart.fields.every(x => x && typeof x.name === 'string' && typeof x.value === 'string') || (payload.multipart.files && (!Array.isArray(payload.multipart.files) || payload.multipart.files.length > 1)))) return fail(400, 'Invalid multipart fields.');
  if (payload.body && new TextEncoder().encode(payload.body).byteLength > MAX_REQUEST_BYTES) return fail(413, 'Request body exceeds 1 MiB.');
  if (payload.headers && (typeof payload.headers !== 'object' || Array.isArray(payload.headers))) return fail(400, 'Invalid headers.');
  const headers = new Headers();
  try {
    for (const [key, value] of Object.entries(payload.headers || {})) {
      if (BLOCKED.test(key)) continue;
      if (typeof value !== 'string') return fail(400, 'Header values must be strings.');
      headers.set(key, value);
    }
  } catch { return fail(400, 'Invalid header name or value.'); }
  try {
    let outgoingBody = ['GET', 'HEAD'].includes(method) ? undefined : payload.body;
    if (payload.multipart) {
      const form = new FormData();
      for (const field of payload.multipart.fields) form.append(field.name, field.value);
      for (const file of payload.multipart.files || []) {
        if (!file || typeof file.name !== 'string' || typeof file.filename !== 'string' || typeof file.base64 !== 'string' || typeof file.contentType !== 'string' || file.base64.length > MAX_REQUEST_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) return fail(400, 'Invalid file upload.');
        const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0));
        form.append(file.name, new Blob([bytes], { type: file.contentType }), file.filename);
      }
      headers.delete('content-type');
      outgoingBody = form;
    }
    const response = await fetch(url.toString(), {
      method, headers, body: outgoingBody,
      redirect: 'manual', signal: AbortSignal.timeout(25000),
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    const declaredResponse = Number(response.headers.get('content-length') || 0);
    if (declaredResponse > MAX_RESPONSE_BYTES) return fail(413, 'Response is larger than the 2 MiB preview limit.');
    let bytes;
    try { bytes = await limitedBytes(response.body, MAX_RESPONSE_BYTES); }
    catch { return fail(413, 'Response is larger than the 2 MiB preview limit.'); }
    const contentType = response.headers.get('content-type') || '';
    const textual = isText(contentType);
    return Response.json({
      status: response.status, statusText: response.statusText, contentType,
      headers: [...response.headers].map(([key, value]) => ({ id: crypto.randomUUID(), key, value, enabled: true })),
      text: textual ? new TextDecoder().decode(bytes) : '',
      bodyBase64: textual ? undefined : base64(bytes), size: bytes.byteLength, duration: 0,
      redirected: response.status >= 300 && response.status < 400,
    }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return fail(502, 'Upstream request failed. Check the destination host, TLS configuration, and Cloudflare network restrictions.');
  }
}
export function onRequest() { return fail(405, 'Method not allowed.'); }
