import { parseDocument } from 'yaml';
import { newId, newRequest, type Collection, type Folder, type HttpMethod, type RequestModel } from '../types';
import type { ImportedCollection } from './postman';

type Json = Record<string, unknown>;
const object = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): string => typeof v === 'string' ? v : '';
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const maxOperations = 1500;
const maxSpecBytes = 2 * 1024 * 1024;

/** Parse JSON or YAML locally. No network fetching, remote references, or scripts. */
export function parseApiDefinitionText(text: string): ImportedCollection {
  if (new TextEncoder().encode(text).byteLength > maxSpecBytes) throw new Error('API definition exceeds the 2 MiB import limit.');
  let data: unknown;
  if (text.trimStart().startsWith('{')) {
    try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON API definition.'); }
  } else {
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length) throw new Error(`Invalid YAML: ${document.errors[0].message}`);
    data = document.toJS({ maxAliasCount: 10 });
  }
  return parseApiDefinition(data);
}

function resolve(root: Json, value: unknown, depth = 0, seen = new Set<string>()): unknown {
  if (!object(value) || !('$ref' in value)) return value;
  const ref = string(value.$ref);
  if (!ref.startsWith('#/')) throw new Error(`External $ref is not supported: ${ref.slice(0, 100)}`);
  if (depth >= 12 || seen.has(ref)) throw new Error(`Circular or overly deep $ref: ${ref}`);
  const segments = ref.slice(2).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let at: unknown = root;
  for (const segment of segments) {
    if (['__proto__', 'constructor', 'prototype'].includes(segment) || !object(at) || !Object.hasOwn(at, segment)) {
      throw new Error(`Cannot resolve local $ref: ${ref}`);
    }
    at = at[segment];
  }
  return resolve(root, at, depth + 1, new Set([...seen, ref]));
}

function sample(schema: unknown, root: Json, depth = 0, ancestors = new Set<unknown>()): unknown {
  if (depth > 6) return null;
  // Cyclic schemas should still import: stop expanding them instead of hanging.
  if (object(schema) && typeof schema.$ref === 'string' && ancestors.has(schema.$ref)) return null;
  const nextSeen = new Set(ancestors);
  if (object(schema) && typeof schema.$ref === 'string') nextSeen.add(schema.$ref);
  const s = resolve(root, schema);
  if (!object(s)) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (s.nullable === true) return null;
  const combo = ['oneOf', 'anyOf', 'allOf'].find(key => Array.isArray(s[key]) && (s[key] as unknown[]).length);
  if (combo) return sample((s[combo] as unknown[])[0], root, depth + 1, nextSeen);
  if (s.type === 'array') return [sample(s.items, root, depth + 1, nextSeen)];
  if (s.type === 'object' || object(s.properties)) {
    const result: Json = {};
    for (const [key, prop] of Object.entries(object(s.properties) ? s.properties : {}).slice(0, 50)) {
      result[key] = sample(prop, root, depth + 1, nextSeen);
    }
    return result;
  }
  if (s.type === 'integer' || s.type === 'number') return 0;
  if (s.type === 'boolean') return false;
  return '';
}

function contentBody(body: unknown, root: Json, request: RequestModel): void {
  const source = resolve(root, body);
  if (!object(source) || !object(source.content)) return;
  const content = source.content;
  const preference = ['application/json', 'application/*+json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/graphql', 'text/plain'];
  const mime = preference.find(v => object(content[v])) || Object.keys(content).find(v => object(content[v]));
  if (!mime) return;
  const media = content[mime];
  if (!object(media)) return;
  const value = media.example !== undefined ? media.example : sample(media.schema, root);
  if (mime === 'application/x-www-form-urlencoded' || mime === 'multipart/form-data') {
    request.bodyType = mime === 'multipart/form-data' ? 'form-data' : 'urlencoded';
    request.body = object(value) ? Object.entries(value).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') : '';
  } else if (mime.includes('json')) {
    request.bodyType = 'json'; request.body = JSON.stringify(value, null, 2);
  } else {
    request.bodyType = 'text'; request.body = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    request.headers.push({ id: newId(), key: 'Content-Type', value: mime, enabled: true });
  }
}

function authFor(operation: Json, root: Json, request: RequestModel) {
  const security = operation.security === undefined ? root.security : operation.security;
  if (!Array.isArray(security) || !security.length) return;
  const defs = object(root.components) && object(root.components.securitySchemes) ? root.components.securitySchemes : {};
  for (const securityRequirement of security) {
    if (!object(securityRequirement)) continue;
    for (const [name, requestedScopes] of Object.entries(securityRequirement)) {
      const scheme = resolve(root, defs[name]);
      if (!object(scheme)) continue;
      if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        request.auth = { ...request.auth, type: 'bearer', token: '{{accessToken}}' }; return;
      }
      if (scheme.type === 'http' && scheme.scheme === 'basic') {
        request.auth = { ...request.auth, type: 'basic', username: '{{username}}', password: '{{password}}' }; return;
      }
      if (scheme.type === 'apiKey' && (scheme.in === 'header' || scheme.in === 'query')) {
        request.auth = { ...request.auth, type: 'api-key', key: string(scheme.name), value: `{{${name}}}`, location: scheme.in }; return;
      }
      if (scheme.type === 'oauth2' && object(scheme.flows) && object(scheme.flows.authorizationCode)) {
        const flow = scheme.flows.authorizationCode;
        request.auth = { ...request.auth, type: 'oauth2', token: '{{accessToken}}', authorizationUrl: string(flow.authorizationUrl), tokenUrl: string(flow.tokenUrl), scope: Array.isArray(requestedScopes) ? requestedScopes.map(string).join(' ') : '' };
        return;
      }
    }
  }
}

function baseUrl(root: Json): string {
  const servers = Array.isArray(root.servers) ? root.servers : [];
  const first = servers.find(object);
  if (!first || !string(first.url)) return '{{baseUrl}}';
  let url = string(first.url);
  if (object(first.variables)) for (const [key, variable] of Object.entries(first.variables)) {
    const value = object(variable) ? variable.default : undefined;
    url = url.replaceAll(`{${key}}`, value == null ? `{{${key}}}` : String(value));
  }
  if (/^https?:\/\//i.test(url)) return url.replace(/\/$/, '');
  // Relative server URLs need a browser-independent hostname from the user.
  return `{{baseUrl}}${url.startsWith('/') ? '' : '/'}${url}`.replace(/\/$/, '');
}

function namedParameters(root: Json, pathItem: Json, operation: Json): Json[] {
  const map = new Map<string, Json>();
  for (const value of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
    const parameter = resolve(root, value);
    if (!object(parameter) || !string(parameter.name)) continue;
    map.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...map.values()];
}

export function parseApiDefinition(value: unknown): ImportedCollection {
  if (!object(value) || !/^3\.(0|1)\./.test(string(value.openapi)) || !object(value.paths)) {
    throw new Error('Expected an OpenAPI 3.0 or 3.1 JSON/YAML definition. Swagger 2.0 is not supported.');
  }
  const title = object(value.info) ? string(value.info.title) : '';
  const collection: Collection = { id: newId(), name: title || 'Imported OpenAPI', createdAt: Date.now() };
  const folders: Folder[] = [];
  const folderIds = new Map<string, string>();
  const requests: RequestModel[] = [];
  const globalBase = baseUrl(value);
  const paths = Object.entries(value.paths);
  if (paths.length > 2000) throw new Error('API definition has too many paths.');
  for (const [path, raw] of paths) {
    const pathItem = resolve(value, raw);
    if (!object(pathItem) || !path.startsWith('/')) continue;
    for (const method of methods) {
      const op = pathItem[method.toLowerCase()];
      if (!object(op)) continue;
      if (requests.length >= maxOperations) throw new Error(`API definition exceeds ${maxOperations} operations.`);
      const tag = Array.isArray(op.tags) ? string(op.tags[0]) : '';
      const folderName = tag || 'Other';
      if (!folderIds.has(folderName)) {
        const folder: Folder = { id: newId(), name: folderName, collectionId: collection.id };
        folders.push(folder); folderIds.set(folderName, folder.id);
      }
      const request = newRequest();
      request.collectionId = collection.id; request.folderId = folderIds.get(folderName);
      request.method = method;
      request.name = string(op.summary) || string(op.operationId) || `${method} ${path}`;
      const urlPath = path.replace(/\{([^{}]+)\}/g, (_, key: string) => `{{${key}}}`);
      const operationServer = Array.isArray(op.servers) && op.servers.length ? op.servers[0] : undefined;
      const pathServer = Array.isArray(pathItem.servers) && pathItem.servers.length ? pathItem.servers[0] : undefined;
      const host = operationServer || pathServer ? baseUrl({ servers: [operationServer || pathServer] }) : globalBase;
      request.url = `${host}${urlPath}`;
      request.bodyType = 'none'; request.body = '';
      request.headers = [];
      const params = namedParameters(value, pathItem, op);
      for (const p of params) {
        const name = string(p.name);
        const placeholder = `{{${name}}}`;
        const initial = p.example !== undefined ? String(p.example) : object(p.schema) && p.schema.default !== undefined ? String(p.schema.default) : placeholder;
        if (p.in === 'query') {
          const [head, fragment] = request.url.split('#');
          const separator = head.includes('?') ? '&' : '?';
          request.url = head + separator + encodeURIComponent(name) + '=' + encodeURIComponent(initial) + (fragment ? `#${fragment}` : '');
        } else if (p.in === 'header') {
          request.headers.push({ id: newId(), key: name, value: initial, enabled: true });
        } else if (p.in === 'path' && p.example !== undefined) {
          // Preserve variable placeholders so the value remains editable using environments.
        }
      }
      if (op.requestBody) contentBody(op.requestBody, value, request);
      authFor(op, value, request);
      requests.push(request);
    }
  }
  if (!requests.length) throw new Error('No supported HTTP operations found in the OpenAPI definition.');
  return { collection, folders, requests };
}
