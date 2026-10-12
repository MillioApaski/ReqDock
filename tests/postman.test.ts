import { describe, expect, it, vi } from 'vitest';
import { exportPostmanCollection, parsePostmanCollection, parsePostmanEnvironment } from '../src/lib/postman';
import { evaluateAssertions } from '../src/lib/assertions';
import { prepareRequest } from '../src/lib/request';
import { exampleRequest, type SavedResponse } from '../src/types';
vi.stubGlobal('crypto', { randomUUID: () => Math.random().toString(16).slice(2) });
const collection = { info: { name: 'Nested', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [
  { name: 'Folder', item: [{ name: 'Create', request: { method: 'POST', url: { raw: 'https://example.com/api' }, header: [{ key: 'X-Key', value: 'a' }], body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } } } }] },
  { name: 'Ping', request: { method: 'GET', url: 'https://example.com/health' } },
] };
describe('Postman v2.1 import export', () => {
  it('preserves nested folders, method, headers, body, and URL', () => {
    const imp = parsePostmanCollection(collection);
    expect(imp.folders).toHaveLength(1);
    expect(imp.requests).toHaveLength(2);
    expect(imp.requests[0].folderId).toBe(imp.folders[0].id);
    expect(imp.requests[0].bodyType).toBe('json');
    const second = parsePostmanCollection(exportPostmanCollection(imp.collection, imp.folders, imp.requests));
    expect(second.requests.map(r => r.url)).toEqual(imp.requests.map(r => r.url));
  });
  it('rejects invalid format', () => expect(() => parsePostmanCollection({ item: [] })).toThrow());
  it('imports environment variables', () => {
    expect(parsePostmanEnvironment({ name: 'dev', values: [{ key: 'api', value: 'https://example.com', enabled: true }] }).variables[0].value).toBe('https://example.com');
  });
});
describe('GraphQL and response assertions', () => {
  it('creates a valid GraphQL POST body and variables', () => {
    const req = exampleRequest(); req.method = 'POST'; req.bodyType = 'graphql'; req.body = 'query { ping }'; req.graphqlVariables = '{"id":3}';
    expect(JSON.parse(prepareRequest(req).body || '')).toEqual({ query: 'query { ping }', variables: { id: 3 } });
  });
  it('reports failing assertions without executing code', () => {
    const response: SavedResponse = { status: 201, statusText: 'Created', text: '{"data":{"id":42}}', headers: [{ id: '1', key: 'content-type', value: 'application/json', enabled: true }], contentType: 'application/json', duration: 50, size: 18 };
    const results = evaluateAssertions([
      { id: '1', kind: 'status', target: '', expected: '200' },
      { id: '2', kind: 'json', target: 'data.id', expected: '42' },
      { id: '3', kind: 'duration', target: '', expected: '100' },
      { id: '4', kind: 'json', target: 'constructor.constructor', expected: 'x' },
    ], response);
    expect(results.map(x => x.passed)).toEqual([false, true, true, false]);
  });
});

describe('multipart form-data', () => {
  it('prepares name=value fields without overriding browser-generated boundaries', () => {
    const request = exampleRequest(); request.method = 'POST'; request.bodyType = 'form-data'; request.body = 'first=hello\nsecond=some=value';
    const result = prepareRequest(request);
    expect(result.multipart?.fields).toEqual([{ name: 'first', value: 'hello' }, { name: 'second', value: 'some=value' }]);
    expect(result.body).toBeUndefined();
  });
});
