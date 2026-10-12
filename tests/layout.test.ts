import { describe, expect, it } from 'vitest';
import { clampPaneRatio, DEFAULT_PANE_RATIO } from '../src/lib/layout';
describe('resizable workspace layout', () => {
  it('clamps a split that would hide either editor', () => {
    expect(clampPaneRatio(0)).toBe(28);
    expect(clampPaneRatio(100)).toBe(72);
    expect(clampPaneRatio(54.6)).toBe(55);
  });
  it('falls back when storage is corrupted', () => {
    expect(clampPaneRatio(NaN)).toBe(DEFAULT_PANE_RATIO);
    expect(clampPaneRatio(Infinity)).toBe(DEFAULT_PANE_RATIO);
  });
});
