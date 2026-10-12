/** Tabs are a session-only view of saved requests. Closing never deletes a request. */
export function restoreTabs(stored: unknown, availableIds: string[], fallbackId: string): string[] {
  const allowed = new Set(availableIds);
  const ids = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && allowed.has(id)) : [];
  return [...new Set(ids)].slice(0, 20).length ? [...new Set(ids)].slice(0, 20) : [fallbackId];
}
export function openTab(tabs: string[], id: string): string[] {
  return tabs.includes(id) ? tabs : [...tabs.slice(-19), id];
}
export function closeTab(tabs: string[], id: string): { tabs: string[]; nextId?: string } {
  if (!tabs.includes(id) || tabs.length === 1) return { tabs };
  const pos = tabs.indexOf(id);
  const remaining = tabs.filter(x => x !== id);
  return { tabs: remaining, nextId: remaining[Math.min(pos, remaining.length - 1)] };
}
