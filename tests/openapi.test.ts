import { describe, it, expect } from 'vitest';
import { parseApiDefinition, parseApiDefinitionText } from '../src/lib/openapi';
import { prepareRequest } from '../src/lib/request';

const spec = {
  openapi: '3.0.3', info: { title: 'Pet API' }, servers: [{ url: 'https://{region}.example.org/v1', variables: { region: { default: 'api' } } }],
  components: {
    parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } } },
    requestBodies: { NewPet: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
    schemas: { Pet: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, active: { type: 'boolean' } } } },
    securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' } },
  },
  security: [{ Bearer: [] }],
  paths: {
    '/pets/{id}': {
      parameters: [{ $ref: '#/components/parameters/Limit' }],
      get: { tags: ['Pets'], summary: 'Get pet', parameters: [{ name: 'x-trace', in: 'header', example: 'test' }] },
      post: { tags: ['Pets'], summary: 'Update pet', requestBody: { $ref: '#/components/requestBodies/NewPet' } },
    },
  },
};

describe('OpenAPI import', () => {
  it('imports operation methods, folders, path variables, default query, headers and security', () => {
    const result = parseApiDefinition(spec);
    expect(result.collection.name).toBe('Pet API');
    expect(result.folders.map(f => f.name)).toEqual(['Pets']);
    expect(result.requests.map(r => r.method)).toEqual(['GET', 'POST']);
    expect(result.requests[0].url).toContain('https://api.example.org/v1/pets/{{id}}?limit=20');
    expect(result.requests[0].headers[0]).toMatchObject({ key: 'x-trace', value: 'test' });
    expect(result.requests[0].auth.type).toBe('bearer');
    expect(result.requests[1].bodyType).toBe('json');
    expect(JSON.parse(result.requests[1].body)).toEqual({ id: 0, name: '', active: false });
    const prepared = prepareRequest(result.requests[0], { id: '1', name: 'dev', variables: [{ id: 'id', key: 'id', value: 'abc', enabled: true }] });
    expect(prepared.url).toContain('/pets/abc?limit=20');
  });
  it('reads YAML with references without network access', () => {
    const data = parseApiDefinitionText('openapi: 3.1.0\ninfo:\n  title: YAML API\npaths:\n  /status:\n    get:\n      summary: Status\n');
    expect(data.requests[0].url).toBe('{{baseUrl}}/status');
    expect(data.requests[0].name).toBe('Status');
  });
  it('supports request-specific server, api key and form data', () => {
    const data = parseApiDefinition({ openapi: '3.1.0', info: { title: 'Demo' }, paths: { '/upload': { post: { servers: [{ url: 'https://files.example.org' }], security: [{ Key: [] }], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string', example: 'Hello' } } } } } } } } }, components: { securitySchemes: { Key: { type: 'apiKey', in: 'query', name: 'secret' } } } });
    expect(data.requests[0].bodyType).toBe('form-data');
    expect(data.requests[0].auth).toMatchObject({ type: 'api-key', key: 'secret', location: 'query' });
    expect(data.requests[0].body).toContain('description=Hello');
  });
  it('rejects external references, prototype names, oversized files, unsupported formats and YAML duplicates', () => {
    const altered = structuredClone(spec);
    (altered.paths['/pets/{id}'].post as Record<string, unknown>).requestBody = { $ref: 'https://bad.example/schema' };
    expect(() => parseApiDefinition(altered)).toThrow(/External \$ref/);
    expect(() => parseApiDefinitionText('openapi: 3.0.0\nopenapi: 3.1.0')).toThrow(/YAML/);
    expect(() => parseApiDefinitionText('x'.repeat(2 * 1024 * 1024 + 1))).toThrow(/limit/);
    expect(() => parseApiDefinition({ swagger: '2.0', paths: {} })).toThrow(/OpenAPI/);
    const bad = structuredClone(spec);
    (bad.paths['/pets/{id}'].post as Record<string, unknown>).requestBody = { $ref: '#/__proto__/pollute' };
    expect(() => parseApiDefinition(bad)).toThrow(/resolve/);
  });
  it('handles self-referencing schemas without recursion', () => {
    const cyclic = {
      openapi: '3.0.0', info: { title: 'Cyclic' }, paths: { '/node': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } } } },
      components: { schemas: { Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } } } },
    };
    expect(JSON.parse(parseApiDefinition(cyclic).requests[0].body)).toEqual({ next: null });
  });
});
