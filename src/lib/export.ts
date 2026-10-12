import type { Environment, RequestModel, Collection, Folder } from '../types';
export function downloadJson(filename: string, value: unknown) {
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
export function readBackup(value: unknown): { requests: RequestModel[]; environments: Environment[]; collections: Collection[]; folders: Folder[] } {
  if (!value || typeof value !== 'object') throw new Error('Invalid JSON backup.');
  const object = value as Record<string, unknown>;
  if (![1, 2].includes(Number(object.version)) || !Array.isArray(object.requests) || !Array.isArray(object.environments)) {
    throw new Error('Not a ReqDock backup (version 1 or 2).');
  }
  const requests = object.requests.filter((r): r is RequestModel => Boolean(r && typeof r === 'object' && typeof r.url === 'string' && typeof r.method === 'string' && typeof r.id === 'string'));
  const environments = object.environments.filter((e): e is Environment => Boolean(e && typeof e === 'object' && typeof e.id === 'string' && Array.isArray(e.variables)));
  const collections = Array.isArray(object.collections) ? object.collections.filter((x): x is Collection => !!x && typeof x.id === 'string' && typeof x.name === 'string') : [];
  const folders = Array.isArray(object.folders) ? object.folders.filter((x): x is Folder => !!x && typeof x.id === 'string' && typeof x.collectionId === 'string') : [];
  return { requests, environments, collections, folders };
}
