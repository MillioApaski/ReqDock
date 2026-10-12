import { describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/proxy.js';
const make = (url: string, env: Record<string, string> = {}) => ({
  request: new Request('https://reqdock.example/api/proxy', {
    method: 'POST', headers: { Origin: 'https://reqdock.example', 'X-ReqDock-Proxy-Key': 'secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method: 'GET', headers: {}, body: '' }),
  }),
  env: { REQDOCK_PROXY_KEY: 'secret', REQDOCK_ALLOWED_HOSTS: 'api.example.com', ...env },
});
describe('Cloud Proxy safety boundaries', () => {
  it('is disabled unless both secrets and the allowlist are configured', async () => {
    const r = await onRequestPost(make('https://api.example.com/', { REQDOCK_PROXY_KEY: '' }));
    expect(r.status).toBe(503);
  });
  it('refuses private addresses, other domains and nonstandard ports before network access', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const url of ['http://127.0.0.1/', 'https://other.example.com/', 'https://api.example.com:8080/', 'ftp://api.example.com/file']) {
      const r = await onRequestPost(make(url));
      expect(r.status).toBe(403);
    }
    expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it('refuses mismatched origins', async () => {
    const request = make('https://api.example.com/'); request.request.headers.set('Origin', 'https://attacker.example');
    const res = await onRequestPost(request);
    expect(res.status).toBe(403);
  });
});
