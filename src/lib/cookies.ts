import type { CookieRecord } from '../types';

/** Browser IndexedDB storage is NOT an HttpOnly security boundary. */
const TOKEN = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/;
export const COOKIE_LIMIT = 200;

export function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith('/') || pathname === '/') return '/';
  const index = pathname.lastIndexOf('/');
  return index <= 0 ? '/' : pathname.slice(0, index);
}
export function cookieKey(cookie: Pick<CookieRecord, 'domain' | 'path' | 'name'>): string {
  return [cookie.domain, cookie.path, cookie.name].join('\t');
}
export function parseSetCookie(header: string, requestUrl: string, now = Date.now()): CookieRecord | null {
  const url = new URL(requestUrl);
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  const parts = header.split(';');
  const first = parts.shift()?.trim() || '';
  const equals = first.indexOf('=');
  if (equals < 1) return null;
  const name = first.slice(0, equals).trim();
  const value = first.slice(equals + 1).trim();
  if (!TOKEN.test(name) || /[\x00-\x1f\x7f;,]/.test(value) || value.length > 4096) return null;
  let path = defaultCookiePath(url.pathname);
  let secure = false, httpOnly = false, domainSpecified = false;
  let expiresAt: number | null = null;
  let maxAge: number | null = null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase();
    const val = eq < 0 ? '' : part.slice(eq + 1).trim();
    if (key === 'domain') {
      domainSpecified = true;
      // Deliberately restrict to exact host. No parent-domain or public-suffix cookies.
      if (val.replace(/^\./, '').toLowerCase() !== host) return null;
    } else if (key === 'path' && val.startsWith('/')) path = val;
    else if (key === 'secure') secure = true;
    else if (key === 'httponly') httpOnly = true;
    else if (key === 'max-age' && /^-?\d+$/.test(val)) maxAge = Number(val);
    else if (key === 'expires' && Number.isFinite(Date.parse(val))) expiresAt = Date.parse(val);
  }
  if (maxAge !== null) expiresAt = maxAge <= 0 ? now - 1 : Math.min(Number.MAX_SAFE_INTEGER, now + maxAge * 1000);
  if (secure && url.protocol !== 'https:') return null;
  if (name.startsWith('__Secure-') && (!secure || url.protocol !== 'https:')) return null;
  if (name.startsWith('__Host-') && (!secure || url.protocol !== 'https:' || path !== '/' || domainSpecified)) return null;
  const cookie: CookieRecord = { id: '', name, value, domain: host, path, secure, httpOnly, expiresAt, updatedAt: now };
  cookie.id = cookieKey(cookie);
  return cookie;
}
function matchesPath(cookiePath: string, requestPath: string): boolean {
  return requestPath === cookiePath || (requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/'));
}
export function cookiesForUrl(jar: CookieRecord[], requestUrl: string, now = Date.now()): CookieRecord[] {
  const url = new URL(requestUrl);
  return jar.filter(cookie => cookie.domain === url.hostname.toLowerCase() &&
    (cookie.expiresAt === null || cookie.expiresAt > now) &&
    (!cookie.secure || url.protocol === 'https:') &&
    matchesPath(cookie.path, url.pathname))
    .sort((a, b) => b.path.length - a.path.length || a.updatedAt - b.updatedAt);
}
export function cookieHeader(jar: CookieRecord[], requestUrl: string, now = Date.now()): string {
  return cookiesForUrl(jar, requestUrl, now).map(cookie => cookie.name + '=' + cookie.value).join('; ');
}
export function applySetCookies(jar: CookieRecord[], requestUrl: string, headers: string[], now = Date.now()): CookieRecord[] {
  const map = new Map(jar.filter(cookie => cookie.expiresAt === null || cookie.expiresAt > now)
    .map(cookie => [cookieKey(cookie), cookie]));
  for (const header of headers) {
    const cookie = parseSetCookie(header, requestUrl, now);
    if (!cookie) continue;
    if (cookie.expiresAt !== null && cookie.expiresAt <= now) map.delete(cookie.id);
    else map.set(cookie.id, cookie);
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, COOKIE_LIMIT);
}
