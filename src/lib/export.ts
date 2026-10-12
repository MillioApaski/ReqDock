import type { Environment, RequestModel } from '../types';
export function downloadJson(filename: string, value: unknown) {
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
export function readBackup(value: unknown): { requests: RequestModel[]; environments: Environment[] } {
  if (!value || typeof value !== 'object') throw new Error('Invalid JSON backup.');
  const object = value as Record<string, unknown>;
  if (object.version !== 1 || !Array.isArray(object.requests) || !Array.isArray(object.environments)) {
    throw new Error('Not a ReqDock backup (version 1).');
  }
  const requests = object.requests.filter((r): r is RequestModel => Boolean(r && typeof r === 'object' && typeof r.url === 'string' && typeof r.method === 'string' && typeof r.id === 'string'));
  const environments = object.environments.filter((e): e is Environment => Boolean(e && typeof e === 'object' && typeof e.id === 'string' && Array.isArray(e.variables)));
  return { requests, environments };
}
