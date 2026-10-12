import { newId, newRequest, type Collection, type Environment, type Folder, type HttpMethod, type KeyValue, type RequestModel } from '../types';

/** A deliberately strict subset of the Postman Collection v2.1 exchange format. */
type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const pair = (key: string, value: string, enabled = true): KeyValue => ({ id: newId(), key, value, enabled });
const asText = (v: unknown): string => typeof v === 'string' ? v : '';
const pairsFrom = (value: unknown): KeyValue[] => Array.isArray(value) ? value.filter(isObject).map(x => pair(asText(x.key), asText(x.value), !x.disabled)) : [];

export type ImportedCollection = { collection: Collection; folders: Folder[]; requests: RequestModel[] };
export function parsePostmanCollection(value: unknown): ImportedCollection {
  if (!isObject(value) || !isObject(value.info) || !Array.isArray(value.item) || !/collection\/v2\.1(\.0)?/.test(asText(value.info.schema))) {
    throw new Error('Expected a Postman Collection v2.1 JSON file.');
  }
  const collection: Collection = { id: newId(), name: asText(value.info.name) || 'Imported collection', createdAt: Date.now() };
  const folders: Folder[] = [], requests: RequestModel[] = [];
  let count = 0;
  function walk(items: unknown[], parentId?: string, depth = 0) {
    if (depth > 20 || count > 2000) throw new Error('Collection exceeds the import safety limit.');
    for (const item of items) {
      if (!isObject(item)) continue;
      count++;
      if (Array.isArray(item.item)) {
        const folder: Folder = { id: newId(), name: asText(item.name) || 'Folder', collectionId: collection.id, parentId };
        folders.push(folder); walk(item.item, folder.id, depth + 1); continue;
      }
      if (!isObject(item.request)) continue;
      const source = item.request;
      const rawUrl = typeof source.url === 'string' ? source.url : isObject(source.url) ? asText(source.url.raw) : '';
      const url = rawUrl || (isObject(source.url) ? buildUrl(source.url) : '');
      if (!url) continue;
      const req = newRequest();
      const method = asText(source.method).toUpperCase();
      req.method = (['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method) ? method : 'GET') as HttpMethod;
      req.id = newId(); req.name = asText(item.name) || req.method + ' ' + url;
      req.collectionId = collection.id; req.folderId = parentId;
      req.url = url; req.headers = pairsFrom(source.header);
      const authConfig = source.auth;
      if (isObject(authConfig)) {
        const kind = asText(authConfig.type);
        if (kind === 'bearer' && Array.isArray(authConfig.bearer)) {
          const token = authConfig.bearer.find((x: unknown) => isObject(x) && x.key === 'token');
          req.auth = { ...req.auth, type: 'bearer', token: isObject(token) ? asText(token.value) : '' };
        } else if (kind === 'basic' && Array.isArray(authConfig.basic)) {
          const entries = authConfig.basic;
          const get = (key: string) => { const found = entries.find((x: unknown) => isObject(x) && x.key === key); return isObject(found) ? asText(found.value) : ''; };
          req.auth = { ...req.auth, type: 'basic', username: get('username'), password: get('password') };
        } else if (kind === 'apikey' && Array.isArray(authConfig.apikey)) {
          const entries = authConfig.apikey;
          const get = (key: string) => { const found = entries.find((x: unknown) => isObject(x) && x.key === key); return isObject(found) ? asText(found.value) : ''; };
          req.auth = { ...req.auth, type: 'api-key', key: get('key'), value: get('value'), location: get('in') === 'query' ? 'query' : 'header' };
        }
      }
      if (isObject(source.body)) {
        if (source.body.mode === 'raw') {
          req.body = asText(source.body.raw);
          req.bodyType = isObject(source.body.options) && isObject(source.body.options.raw) && source.body.options.raw.language === 'json' ? 'json' : 'text';
        } else if (source.body.mode === 'urlencoded' && Array.isArray(source.body.urlencoded)) {
          req.bodyType = 'urlencoded'; req.body = pairsFrom(source.body.urlencoded).filter(p => p.enabled).map(p => `${p.key}=${p.value}`).join('\n');
        }
      } else req.bodyType = 'none';
      requests.push(req);
    }
  }
  walk(value.item);
  return { collection, folders, requests };
}
function buildUrl(input: Json) {
  const protocol = asText(input.protocol) || 'https';
  const host = Array.isArray(input.host) ? input.host.join('.') : asText(input.host);
  const path = Array.isArray(input.path) ? input.path.map(x => encodeURIComponent(String(x))).join('/') : asText(input.path);
  const query = pairsFrom(input.query).filter(p => p.enabled);
  return `${protocol}://${host}${path ? '/' + path : ''}${query.length ? '?' + new URLSearchParams(query.map(x => [x.key, x.value])).toString() : ''}`;
}
export function exportPostmanCollection(collection: Collection, folders: Folder[], requests: RequestModel[]): Json {
  const makeRequest = (req: RequestModel): Json => {
    const auth = (req.auth.type === 'bearer' || req.auth.type === 'oauth2') ? { type: 'bearer', bearer: [{ key: 'token', value: req.auth.token, type: 'string' }] }
      : req.auth.type === 'basic' ? { type: 'basic', basic: [{ key: 'username', value: req.auth.username }, { key: 'password', value: req.auth.password }] }
      : req.auth.type === 'api-key' ? { type: 'apikey', apikey: [{ key: 'key', value: req.auth.key }, { key: 'value', value: req.auth.value }, { key: 'in', value: req.auth.location }] } : undefined;
    const headers = req.headers.map(h => ({ key: h.key, value: h.value, disabled: !h.enabled }));
    const body = req.bodyType === 'none' ? undefined : req.bodyType === 'urlencoded'
      ? { mode: 'urlencoded', urlencoded: req.body.split('\n').filter(Boolean).map(line => { const i = line.indexOf('='); return { key: line.slice(0, i), value: line.slice(i + 1) }; }) }
      : { mode: 'raw', raw: req.body, options: { raw: { language: req.bodyType === 'json' ? 'json' : 'text' } } };
    return { name: req.name, request: { method: req.method, url: req.url, header: headers, ...(auth ? { auth } : {}), ...(body ? { body } : {}) } };
  };
  const descendants = (parentId?: string, depth = 0): Json[] => {
    if (depth > 20) return [];
    return [
      ...folders.filter(f => f.collectionId === collection.id && f.parentId === parentId).map(f => ({ name: f.name, item: descendants(f.id, depth + 1) })),
      ...requests.filter(r => r.collectionId === collection.id && r.folderId === parentId).map(makeRequest),
    ];
  };
  return { info: { name: collection.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: descendants() };
}

export function parsePostmanEnvironment(value: unknown): Environment {
  if (!isObject(value) || !Array.isArray(value.values)) throw new Error('Invalid Postman environment JSON.');
  return { id: newId(), name: asText(value.name) || 'Imported environment', variables: value.values.filter(isObject).map(x => pair(asText(x.key), asText(x.value), x.enabled !== false)) };
}
export function exportPostmanEnvironment(env: Environment) {
  return { id: env.id, name: env.name, values: env.variables.map(v => ({ key: v.key, value: v.value, enabled: v.enabled, type: 'default' })), _postman_variable_scope: 'environment' };
}
