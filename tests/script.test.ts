import { describe, expect, it, vi } from 'vitest';
import { applyWorkflowScript } from '../src/lib/script';
import { prepareRequest } from '../src/lib/request';
import { exampleRequest, type Environment, type SavedResponse } from '../src/types';
vi.stubGlobal('crypto', { randomUUID: () => 'sample-guid' });
const empty: Environment = { id: '1', name: 'Development', variables: [] };
const response: SavedResponse = { status: 200, statusText: 'OK', text: '{"access_token":"secret","user":{"id":27}}', duration: 20, size: 30, contentType: 'application/json', headers: [{ id: '1', key: 'X-Trace', value: 'abc', enabled: true }] };
describe('safe script workflow DSL', () => {
  it('uses dynamic variables before a request', () => {
    const before = applyWorkflowScript('set id={{$guid}}\nset x={{id}}', empty, 'before');
    const req = exampleRequest(); req.url = 'https://example.com/users/{{id}}';
    expect(prepareRequest(req, before.environment).url).toBe('https://example.com/users/sample-guid');
    expect(before.environment.variables.find(v => v.key === 'x')?.value).toBe('sample-guid');
    expect(empty.variables).toHaveLength(0);
  });
  it('captures JSON and headers and evaluates expectations', () => {
    const result = applyWorkflowScript('capture token=json.access_token\ncapture trace=header.X-Trace\nexpect status=200\nexpect json.user.id=27\nexpect header.X-Trace=bad', empty, 'after', response);
    expect(result.environment.variables.find(v => v.key === 'token')?.value).toBe('secret');
    expect(result.checks.map(x => x.passed)).toEqual([true, true, false]);
  });
  it('blocks unsupported JavaScript and unsafe paths', () => {
    expect(() => applyWorkflowScript('eval(1 + 1)', empty, 'before')).toThrow('Script line 1');
    expect(() => applyWorkflowScript('capture token=json.__proto__.constructor', empty, 'after', response)).toThrow('Unsafe JSON path segment');
    expect(() => applyWorkflowScript('capture a=json["secret"]', empty, 'after', response)).toThrow();
    expect(() => applyWorkflowScript('capture token=json.access_token', empty, 'before')).toThrow();
  });
});
