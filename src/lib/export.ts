import type { Environment, RequestModel, Collection, Folder, GrpcRequestPreset } from '../types';
export function downloadJson(filename: string, value: unknown) {
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
export function readBackup(value: unknown): { requests: RequestModel[]; environments: Environment[]; collections: Collection[]; folders: Folder[]; grpcRequests: GrpcRequestPreset[] } {
  if (!value || typeof value !== 'object') throw new Error('Invalid JSON backup.');
  const object = value as Record<string, unknown>;
  if (![1, 2, 3].includes(Number(object.version)) || !Array.isArray(object.requests) || !Array.isArray(object.environments)) {
    throw new Error('Not a ReqDock backup (version 1, 2 or 3).');
  }
  const requests = object.requests.filter((r): r is RequestModel => Boolean(r && typeof r === 'object' && typeof r.url === 'string' && typeof r.method === 'string' && typeof r.id === 'string'));
  const environments = object.environments.filter((e): e is Environment => Boolean(e && typeof e === 'object' && typeof e.id === 'string' && Array.isArray(e.variables)));
  const collections = Array.isArray(object.collections) ? object.collections.filter((x): x is Collection => !!x && typeof x.id === 'string' && typeof x.name === 'string') : [];
  const folders = Array.isArray(object.folders) ? object.folders.filter((x): x is Folder => !!x && typeof x.id === 'string' && typeof x.collectionId === 'string') : [];
  if (Number(object.version) === 3 && !Array.isArray(object.grpcRequests)) {
    throw new Error('ReqDock v3 backup is missing its gRPC request array.');
  }
  const grpcRequests = Array.isArray(object.grpcRequests) ? object.grpcRequests.filter((value): value is GrpcRequestPreset => {
    if (!value || typeof value !== 'object') return false;
    const x = value as Record<string, unknown>;
    return typeof x.id === 'string' && !!x.id && typeof x.name === 'string' &&
      typeof x.collectionId === 'string' && typeof x.target === 'string' &&
      typeof x.proto === 'string' && x.proto.length <= 128 * 1024 &&
      typeof x.entryName === 'string' && typeof x.service === 'string' &&
      typeof x.method === 'string' && typeof x.message === 'string' && typeof x.metadata === 'string' &&
      ['files', 'reflection'].includes(String(x.source)) &&
      ['unary', 'server-stream', 'client-stream', 'bidi'].includes(String(x.callMode)) &&
      Array.isArray(x.protoFiles) && x.protoFiles.length <= 31 &&
      x.protoFiles.every(file => file && typeof file === 'object' &&
        typeof file.name === 'string' && typeof file.content === 'string' &&
        file.content.length <= 128 * 1024);
  }) : [];
  return { requests, environments, collections, folders, grpcRequests };
}
