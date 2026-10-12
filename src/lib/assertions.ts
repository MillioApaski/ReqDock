import { newId, type Assertion, type SavedResponse } from '../types';
export type AssertionResult = { id: string; passed: boolean; label: string; actual: string };
export function evaluateAssertions(assertions: Assertion[], response: SavedResponse): AssertionResult[] {
  return assertions.map(rule => {
    let actual = '', passed = false;
    if (rule.kind === 'status') {
      actual = String(response.status); passed = actual === rule.expected.trim();
    } else if (rule.kind === 'duration') {
      actual = String(response.duration); passed = Number.isFinite(+rule.expected) && response.duration <= +rule.expected;
    } else if (rule.kind === 'contains') {
      actual = response.text.slice(0, 100); passed = response.text.includes(rule.expected);
    } else if (rule.kind === 'header') {
      actual = response.headers.find(h => h.key.toLowerCase() === rule.target.trim().toLowerCase())?.value ?? '';
      passed = actual === rule.expected;
    } else if (rule.kind === 'json') {
      try {
        const parsed: unknown = JSON.parse(response.text);
        // Explicit path segment parser, not JS evaluation or a user-defined script.
        if (!/^(?:\$\.)?[\w-]+(?:\.[\w-]+|\[\d+\])*$/u.test(rule.target)) throw new Error('Invalid path');
        const pieces = rule.target.replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1').split('.');
        let value: unknown = parsed;
        for (const part of pieces) {
          if (!value || typeof value !== 'object' || !(part in value)) { value = undefined; break; }
          value = (value as Record<string, unknown>)[part];
        }
        actual = value === undefined ? '(missing)' : typeof value === 'string' ? value : JSON.stringify(value);
        passed = actual === rule.expected;
      } catch { actual = '(invalid JSON or path)'; }
    }
    return { id: rule.id, passed, label: `${rule.kind}${rule.target ? ` ${rule.target}` : ''} = ${rule.expected}`, actual };
  });
}
export const newAssertion = (): Assertion => ({ id: newId(), kind: 'status', target: '', expected: '200' });
