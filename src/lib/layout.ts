/** Persisted splitter position, clamped to keep both panes usable. */
export const DEFAULT_PANE_RATIO = 53;
export function clampPaneRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PANE_RATIO;
  return Math.min(72, Math.max(28, Math.round(value)));
}
