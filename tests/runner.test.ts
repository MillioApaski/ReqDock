import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCollection } from '../src/lib/runner';
import { exampleRequest, type Environment } from '../src/types';
afterEach(() => vi.unstubAllGlobals());
describe('collection runner variable chaining', () => {
  it('captures a response token and interpolates it into the next request', async () => {
    const first = exampleRequest(); first.url = 'https://example.com/token'; first.postScript = 'capture token=json.access_token\nexpect status=200';
    const second = exampleRequest(); second.url = 'https://example.com/secure'; second.auth = { ...second.auth, type: 'bearer', token: '{{token}}' };
    const seen: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'received-token' } : { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const environment: Environment = { id: 'dev', name: 'Development', variables: [] };
    let saved: Environment | undefined;
    const results = await runCollection([first, second], environment, 'direct', '', new AbortController().signal, undefined, env => { saved = env; });
    expect(seen).toHaveLength(2);
    expect(seen[1].headers.Authorization).toBe('Bearer received-token');
    expect(results[0].assertions.every(x => x.passed)).toBe(true);
    expect(saved?.variables.find(v => v.key === 'token')?.value).toBe('received-token');
    expect(environment.variables).toHaveLength(0);
  });
});


describe('proxy cookie chaining', () => {
  it('passes upstream login cookies only to later requests on the same host', async () => {
    const first = exampleRequest(); first.url = 'https://api.example.com/login';
    const second = exampleRequest(); second.url = 'https://api.example.com/profile';
    const other = exampleRequest(); other.url = 'https://other.example.com/profile';
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const outgoing = JSON.parse(String(options.body));
      seen.push(outgoing);
      return Response.json({
        status: 200, statusText: 'OK', headers: [], text: '{}',
        contentType: 'application/json', duration: 0, size: 2,
        setCookies: outgoing.url.endsWith('/login') ? ['sid=secret; Secure; Path=/'] : [],
      });
    }));
    const captured: Array<{ name: string; domain: string }> = [];
    const results = await runCollection([first, second, other], undefined, 'proxy', 'key', new AbortController().signal,
      undefined, undefined, { cookies: [], onChange: async updated => {
        captured.splice(0, captured.length, ...updated.map(x => ({ name:x.name, domain:x.domain })));
      } });
    expect(results).toHaveLength(3);
    expect(captured).toEqual([{ name: 'sid', domain: 'api.example.com' }]);
    expect(seen[0].headers.Cookie).toBeUndefined();
    expect(seen[1].headers.Cookie).toBe('sid=secret');
    expect(seen[2].headers.Cookie).toBeUndefined();
  });
});
