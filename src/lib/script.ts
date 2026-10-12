import { interpolate } from './request';
import type { AssertionResult } from './assertions';
import { blankPair, type Environment, type SavedResponse } from '../types';

export type ScriptPhase = 'before' | 'after';
export type ScriptOutput = { environment: Environment; checks: AssertionResult[] };

/** Request workflow commands are a deliberately constrained DSL, not arbitrary JavaScript. */
export function applyWorkflowScript(source: string, environment: Environment | undefined, phase: ScriptPhase, response?: SavedResponse): ScriptOutput {
  const copy: Environment = environment ? { ...environment, variables: environment.variables.map(v => ({ ...v })) } : { id: '', name: 'Run-scoped variables', variables: [] };
  const checks: AssertionResult[] = [];
  const write = (key: string, value: string) => {
    const existing = copy.variables.find(v => v.key === key);
    if (existing) { existing.value = value; existing.enabled = true; }
    else { copy.variables.push({ ...blankPair(), key, value }); }
  };
  const getJsonPath = (text: string, path: string): unknown => {
    if (!/^(?:\$\.)?[A-Za-z_$][\w$-]*(?:\.[\w$-]+|\[\d+\])*$/u.test(path)) throw new Error(`Invalid JSON path: ${path}`);
    let obj: unknown = JSON.parse(text);
    for (const part of path.replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1').split('.')) {
      if (['__proto__', 'prototype', 'constructor'].includes(part)) throw new Error('Unsafe JSON path segment');
      if (!obj || typeof obj !== 'object' || !Object.prototype.hasOwnProperty.call(obj, part)) return undefined;
      obj = (obj as Record<string, unknown>)[part];
    }
    return obj;
  };
  const readValue = (expression: string): string => {
    if (!response) throw new Error('A response is required for capture/expect commands.');
    if (expression === 'status') return String(response.status);
    if (expression === 'duration') return String(response.duration);
    if (expression === 'body') return response.text;
    if (expression.startsWith('json.')) {
      const item = getJsonPath(response.text, expression.slice(5));
      return item === undefined ? '' : typeof item === 'string' ? item : JSON.stringify(item) ?? '';
    }
    if (expression.startsWith('header.')) return response.headers.find(h => h.key.toLowerCase() === expression.slice(7).toLowerCase())?.value ?? '';
    throw new Error(`Unknown response selector: ${expression}`);
  };
  const lines = source.split(/\r?\n/);
  if (lines.length > 200) throw new Error('Script is limited to 200 lines.');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    try {
      const eq = line.indexOf('=');
      if (line.startsWith('set ') && eq > 4) {
        const key = line.slice(4, eq).trim();
        if (!/^[\w-]{1,100}$/.test(key)) throw new Error('Invalid variable name');
        write(key, interpolate(line.slice(eq + 1).trim(), copy));
      } else if (line.startsWith('unset ')) {
        const key = line.slice(6).trim();
        if (!/^[\w-]{1,100}$/.test(key)) throw new Error('Invalid variable name');
        copy.variables = copy.variables.filter(v => v.key !== key);
      } else if (phase === 'after' && line.startsWith('capture ') && eq > 8) {
        const key = line.slice(8, eq).trim();
        if (!/^[\w-]{1,100}$/.test(key)) throw new Error('Invalid variable name');
        write(key, readValue(line.slice(eq + 1).trim()));
      } else if (phase === 'after' && line.startsWith('expect ') && eq > 7) {
        const selector = line.slice(7, eq).trim(), expected = interpolate(line.slice(eq + 1).trim(), copy);
        const actual = readValue(selector);
        checks.push({ id: `script-${index}`, label: `${selector} = ${expected}`, actual: actual.slice(0, 200), passed: actual === expected });
      } else {
        throw new Error('Unsupported command for this phase');
      }
    } catch (error) { throw new Error(`Script line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  return { environment: copy, checks };
}
