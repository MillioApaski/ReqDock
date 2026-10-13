import { describe, expect, it } from 'vitest';
import { applySetCookies, cookieHeader, defaultCookiePath, parseSetCookie } from '../src/lib/cookies';
const target = 'https://api.example.com/auth/login';

describe('Cloud Proxy cookie jar', () => {
  it('parses attributes and Max-Age takes precedence', () => {
    expect(parseSetCookie('sid=abc; Path=/auth; Secure; HttpOnly; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Max-Age=60', target, 1000))
      .toMatchObject({ name:'sid', value:'abc', domain:'api.example.com', path:'/auth', secure:true, httpOnly:true, expiresAt:61000 });
  });
  it('restricts host, path, HTTPS and expiry', () => {
    const jar = applySetCookies([], target, ['sid=secret; Secure; Path=/auth', 'public=a; Path=/'], 1000);
    expect(cookieHeader(jar, target, 2000)).toBe('sid=secret; public=a');
    expect(cookieHeader(jar, 'https://api.example.com/authx', 2000)).toBe('public=a');
    expect(cookieHeader(jar, 'http://api.example.com/auth', 2000)).toBe('public=a');
    expect(cookieHeader(jar, 'https://evil-api.example.com/auth', 2000)).toBe('');
  });
  it('rejects parent domains, invalid prefixes and control chars', () => {
    for (const value of ['sid=1; Domain=.example.com', 'sid=1; Domain=evil.example.com',
      '__Host-sid=1; Secure; Path=/; Domain=api.example.com', '__Secure-sid=1',
      'bad name=1', 'sid=bad\r\nHeader:evil']) expect(parseSetCookie(value, target)).toBeNull();
  });
  it('updates and removes cookies independently', () => {
    const before = applySetCookies([], target, ['sid=abc; Path=/', 'other=ok'], 1000);
    const next = applySetCookies(before, target, ['sid=def; Path=/', 'other=x; Max-Age=0'], 2000);
    expect(cookieHeader(next, 'https://api.example.com/', 3000)).toBe('sid=def');
  });
  it('applies correct default path and expiry', () => {
    expect(defaultCookiePath('/auth/login')).toBe('/auth');
    const jar = applySetCookies([], target, ['sid=foo; Max-Age=2'], 1000);
    expect(cookieHeader(jar, target, 2000)).toBe('sid=foo');
    expect(cookieHeader(jar, target, 3001)).toBe('');
  });
  it('recognizes Host prefix semantics', () => {
    expect(parseSetCookie('__Host-session=abc; Secure; Path=/', target)?.name).toBe('__Host-session');
    expect(parseSetCookie('__Host-session=abc; Secure; Path=/auth', target)).toBeNull();
  });
});
