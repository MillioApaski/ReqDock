import { describe, expect, it, vi } from 'vitest';
import { exampleRequest, type Environment } from '../src/types';
import { interpolate, paramsFromUrl, prepareRequest, setUrlParams, formatJson } from '../src/lib/request';
import { exportCurl, importCurl, tokenizeShell } from '../src/lib/curl';

vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });

describe('request preparation', () => {
  const environment: Environment = { id: 'test', name: 'test', variables: [{ id: 'x', key: 'baseUrl', value: 'https://api.example.com', enabled: true }, { id: 'y', key: 'token', value: 'SECRET', enabled: true }] };
  it('interpolates variables without altering undefined placeholders', () => {
    expect(interpolate('{{baseUrl}}/v1/{{missing}}', environment)).toBe('https://api.example.com/v1/{{missing}}');
  });
  it('prepares authorization and JSON body', () => {
    const request = exampleRequest(); request.url = '{{baseUrl}}/v1'; request.method = 'POST'; request.body = '{"token":"{{token}}"}';
    request.auth = { ...request.auth, type: 'bearer', token: '{{token}}' };
    const prepared = prepareRequest(request, environment);
    expect(prepared.url).toBe('https://api.example.com/v1');
    expect(prepared.headers.Authorization).toBe('Bearer SECRET');
    expect(prepared.headers['Content-Type']).toBe('application/json');
    expect(prepared.body).toBe('{"token":"SECRET"}');
  });
  it('rejects unsafe protocols and credentials in URLs', () => {
    const request = exampleRequest(); request.url = 'file:///etc/passwd'; expect(() => prepareRequest(request)).toThrow();
    request.url = 'https://user:pass@example.com/'; expect(() => prepareRequest(request)).toThrow();
  });
  it('handles duplicate query keys', () => {
    const params = paramsFromUrl('https://example.com/?a=1&a=2');
    expect(params).toHaveLength(2);
    expect(setUrlParams('https://example.com/#hash', params)).toBe('https://example.com/?a=1&a=2#hash');
  });
  it('formats JSON without damaging plaintext', () => {
    expect(formatJson('{"a":1}')).toContain('\n');
    expect(formatJson('hello')).toBe('hello');
  });
});

describe('cURL imports', () => {
  it('tokenizes quoted values and escaped lines', () => {
    expect(tokenizeShell("curl 'https://x.test' -H 'X-Test: a b'" )).toEqual(['curl', 'https://x.test', '-H', 'X-Test: a b']);
  });
  it('imports typical Postman curl', () => {
    const req = importCurl(`curl --location 'https://api.example.com/v1' --header 'Content-Type: application/json' --data '{"hello":1}'`);
    expect(req.method).toBe('POST');
    expect(req.headers[0].key).toBe('Content-Type');
    expect(req.bodyType).toBe('json');
  });
  it('round-trips header values containing quotes', () => {
    const request = exampleRequest(); request.headers = [{ id: '1', key: 'X-Foo', value: "don't panic", enabled: true }];
    expect(importCurl(exportCurl(request)).headers[0].value).toBe("don't panic");
  });
  it('rejects unsupported options to avoid silent request changes', () => {
    expect(() => importCurl('curl --negotiate https://api.example.com')).toThrow('Unsupported');
  });
});


describe('Local Agent request transport', () => {
  it('requires pairing token before sending', async () => {
    const fetchStub = vi.fn(); vi.stubGlobal('fetch', fetchStub);
    try {
      const { sendRequest } = await import('../src/lib/request');
      await expect(sendRequest({ url:'http://localhost:3000/', method:'GET', headers:{} }, 'agent',
        new AbortController().signal, '', undefined, '')).rejects.toThrow('not paired');
      expect(fetchStub).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('sends the token exclusively to the local agent, not the target API', async () => {
    const fetchStub = vi.fn(async () => Response.json({
      status:200,statusText:'OK',headers:[],text:'{"ok":true}',contentType:'application/json',duration:1,size:11,
    }));
    vi.stubGlobal('fetch',fetchStub);
    try {
      const { sendRequest } = await import('../src/lib/request');
      const response = await sendRequest({ url:'http://localhost:3000/', method:'GET', headers:{Authorization:'Bearer api-token'} },
        'agent', new AbortController().signal, '', undefined, 'local-agent-token');
      expect(response.status).toBe(200);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      const [endpoint, config] = fetchStub.mock.calls[0];
      expect(endpoint).toBe('http://127.0.0.1:47831/request');
      expect(config.headers['X-ReqDock-Agent-Token']).toBe('local-agent-token');
      expect(config.headers['X-ReqDock-Proxy-Key']).toBeUndefined();
      const payload = JSON.parse(config.body);
      expect(payload.url).toBe('http://localhost:3000/');
      expect(payload.headers.Authorization).toBe('Bearer api-token');
      expect(payload.headers['X-ReqDock-Agent-Token']).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });
});
