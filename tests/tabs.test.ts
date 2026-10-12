import { expect, describe, it } from 'vitest';
import { openTab, closeTab, restoreTabs } from '../src/lib/tabs';

describe('request tab session management', () => {
  it('restores only valid, unique saved requests', () => {
    expect(restoreTabs(['a', 'a', 'deleted', 'b', 123], ['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(restoreTabs(null, ['a'], 'a')).toEqual(['a']);
  });
  it('opens once, closes without deleting and keeps one available tab', () => {
    expect(openTab(['a', 'b'], 'b')).toEqual(['a', 'b']);
    const added = openTab(['a', 'b'], 'c');
    expect(closeTab(added, 'b')).toEqual({ tabs: ['a', 'c'], nextId: 'c' });
    expect(closeTab(['a'], 'a')).toEqual({ tabs: ['a'] });
  });
});
