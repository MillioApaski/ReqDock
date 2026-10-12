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
