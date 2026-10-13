import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createAgent } from '../agent/reqdock-agent.mjs';

const token = 'test-token-keep-private';
const origin = 'https://reqdock.convert-alpha.cc';
const running: Array<{close: (done: () => void) => void}> = [];
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
afterEach(async () => {
  for (const server of running.splice(0)) await new Promise(resolve => server.close(resolve));
});

describe('Loopback Local Agent', () => {
  it('rejects invalid origin and token; preflight is origin-scoped', async () => {
    const { server } = createAgent({ port: 0, token, allowedHosts:['127.0.0.1'], allowedOrigins:[origin] });
    running.push(server);
    const port = await listen(server);
    const endpoint = 'http://127.0.0.1:' + port;
    const evil = await fetch(endpoint + '/status', { headers: { origin:'https://evil.example.com', 'x-reqdock-agent-token':token } });
    expect(evil.status).toBe(403);
    const missingToken = await fetch(endpoint + '/status', { headers: { origin } });
    expect(missingToken.status).toBe(401);
    const good = await fetch(endpoint + '/status', { headers: { origin, 'x-reqdock-agent-token':token } });
    expect(good.status).toBe(200);
    expect(good.headers.get('access-control-allow-origin')).toBe(origin);
    const preflight = await fetch(endpoint + '/request', { method:'OPTIONS', headers:{ origin, 'access-control-request-private-network':'true' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
  });
  it('enforces exact target allowlist and never follows redirects', async () => {
    const target = createServer((req,res) => {
      if (req.url === '/jump') { res.writeHead(302, { Location:'https://not-allowed.example/' }); return res.end(); }
      res.writeHead(200, {'Content-Type':'application/json','Set-Cookie':'sid=ok; Path=/'}); res.end(JSON.stringify({ url:req.url }));
    });
    running.push(target);
    const targetPort = await listen(target);
    const { server } = createAgent({ port:0, token, allowedHosts:['127.0.0.1'], allowedOrigins:[origin] });
    running.push(server);
    const port = await listen(server);
    const send = async url => fetch('http://127.0.0.1:' + port + '/request', {
      method:'POST', headers:{ origin, 'Content-Type':'application/json', 'X-ReqDock-Agent-Token':token },
      body:JSON.stringify({url,method:'GET',headers:{}}),
    });
    const denied = await send('https://example.org/');
    expect(denied.status).toBe(400);
    const self = await send('http://127.0.0.1:' + port + '/status');
    expect(self.status).toBe(400);
    const good = await send('http://127.0.0.1:' + targetPort + '/ok');
    expect(good.status).toBe(200);
    const body = await good.json();
    expect(body.status).toBe(200);
    expect(body.text).toContain('/ok');
    expect(body.setCookies).toEqual(['sid=ok; Path=/']);
    const redirect = await (await send('http://127.0.0.1:' + targetPort + '/jump')).json();
    expect(redirect.status).toBe(302);
    expect(redirect.redirected).toBe(true);
  });
  it('checks target host before making any outbound requests', async () => {
    const { server } = createAgent({ port:0, token, allowedHosts:['localhost'], allowedOrigins:[origin] });
    running.push(server);
    const port = await listen(server);
    const response = await fetch('http://127.0.0.1:' + port + '/request', {
      method:'POST',headers:{ origin,'x-reqdock-agent-token':token,'content-type':'application/json' },
      body:JSON.stringify({url:'http://127.0.0.1:43219/private',method:'GET',headers:{}}),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('allowlisted');
  });
});
