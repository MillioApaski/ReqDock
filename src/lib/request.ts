import type { Environment, HttpMethod, KeyValue, RequestModel, SavedResponse, Transport } from '../types';

export function interpolate(input: string, environment?: Environment): string {
  const entries = new Map((environment?.variables || []).filter(x => x.enabled && x.key).map(x => [x.key, x.value]));
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    if (key === '$timestamp') return Math.floor(Date.now() / 1000).toString();
    if (key === '$guid') return crypto.randomUUID();
    return entries.get(key) ?? `{{${key}}}`;
  });
}
export function paramsFromUrl(url: string): KeyValue[] {
  const query = url.split('#')[0].split('?').slice(1).join('?');
  if (!query) return [];
  return Array.from(new URLSearchParams(query), ([key, value]) => ({ id: crypto.randomUUID(), key, value, enabled: true }));
}
export function setUrlParams(url: string, pairs: KeyValue[]): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const raw = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const before = raw.split('?')[0];
  const params = new URLSearchParams();
  pairs.filter(p => p.enabled && p.key).forEach(p => params.append(p.key, p.value));
  return `${before}${params.size ? '?' + params.toString() : ''}${hash}`;
}
function toBase64(text: string): string {
  return btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));
}
export type PreparedRequest = { url: string; method: HttpMethod; headers: Record<string, string>; body?: string };
export function prepareRequest(request: RequestModel, environment?: Environment): PreparedRequest {
  let url = interpolate(request.url.trim(), environment);
  if (!url) throw new Error('Enter a request URL first.');
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (parsed.username || parsed.password) throw new Error('Credentials in URLs are not supported.');
  const headers: Record<string, string> = {};
  request.headers.filter(h => h.enabled && h.key.trim()).forEach(h => { headers[interpolate(h.key.trim(), environment)] = interpolate(h.value, environment); });
  const auth = request.auth;
  if (auth.type === 'bearer' && auth.token) headers.Authorization = `Bearer ${interpolate(auth.token, environment)}`;
  if (auth.type === 'basic') headers.Authorization = `Basic ${toBase64(`${interpolate(auth.username, environment)}:${interpolate(auth.password, environment)}`)}`;
  if (auth.type === 'api-key' && auth.key) {
    if (auth.location === 'header') headers[interpolate(auth.key, environment)] = interpolate(auth.value, environment);
    else parsed.searchParams.set(interpolate(auth.key, environment), interpolate(auth.value, environment));
  }
  url = parsed.toString();
  let body: string | undefined;
  if (!['GET', 'HEAD'].includes(request.method) && request.bodyType !== 'none') {
    body = interpolate(request.body, environment);
    if (request.bodyType === 'urlencoded') {
      const items = new URLSearchParams();
      body.split('\n').filter(Boolean).forEach(line => {
        const eq = line.indexOf('=');
        if (eq > 0) items.append(line.slice(0, eq).trim(), line.slice(eq + 1));
      });
      body = items.toString();
      if (!('Content-Type' in headers) && !('content-type' in headers)) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (request.bodyType === 'json') {
      if (!('Content-Type' in headers) && !('content-type' in headers)) headers['Content-Type'] = 'application/json';
    } else if (!('Content-Type' in headers) && !('content-type' in headers)) headers['Content-Type'] = 'text/plain;charset=UTF-8';
  }
  return { url, method: request.method, headers, body };
}
export function formatJson(input: string): string {
  try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; }
}
export function isTextType(contentType: string): boolean {
  return /^(text\/|application\/(json|xml|graphql|javascript|problem\+json|[^;]+\+json|[^;]+\+xml))|image\/svg\+xml/i.test(contentType);
}
export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 0x4000) result += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return btoa(result);
}
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
const MAX_RESPONSE = 2 * 1024 * 1024;
export async function sendRequest(prepared: PreparedRequest, transport: Transport, signal: AbortSignal, proxyKey: string): Promise<SavedResponse> {
  const start = performance.now();
  if (transport === 'proxy') {
    const response = await fetch('/api/proxy', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(proxyKey ? { 'X-ReqDock-Proxy-Key': proxyKey } : {}) },
      body: JSON.stringify(prepared),
    });
    const result = await response.json() as SavedResponse & { error?: string };
    if (!response.ok) throw new Error(result.error || `Proxy error (${response.status})`);
    return { ...result, duration: Math.round(performance.now() - start) };
  }
  const response = await fetch(prepared.url, { method: prepared.method, headers: prepared.headers, body: prepared.body, signal });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE) throw new Error('Response exceeds the 2 MiB preview limit.');
  const contentType = response.headers.get('content-type') || '';
  const textual = isTextType(contentType) || !contentType;
  return {
    status: response.status, statusText: response.statusText, duration: Math.round(performance.now() - start),
    headers: [...response.headers].map(([key, value]) => ({ id: crypto.randomUUID(), key, value, enabled: true })),
    text: textual ? new TextDecoder().decode(bytes) : '',
    bodyBase64: textual ? undefined : bytesToBase64(bytes),
    contentType, size: bytes.byteLength, redirected: response.redirected,
  };
}
