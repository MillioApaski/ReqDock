import protobuf from 'protobufjs';
import path from 'node:path';

export const MAX_PROTO_FILES = 32;
export const MAX_PROTO_FILE_BYTES = 128 * 1024;
export const MAX_PROTO_TOTAL_BYTES = 512 * 1024;
const VALID_FILE = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)\.(?:\/|$))[\w./-]+\.proto$/;

export function validateProtoName(name) {
  if (typeof name !== 'string' || !VALID_FILE.test(name) || name.length > 240) {
    throw Error('Invalid .proto filename. Use relative paths without ".." or backslashes.');
  }
  return name;
}

export function parseProtoFiles(entryContent, fileList = [], entryName = 'main.proto') {
  validateProtoName(entryName);
  if (!Array.isArray(fileList) || fileList.length > MAX_PROTO_FILES - 1) {
    throw Error('Too many .proto dependencies (maximum 31).');
  }
  if (typeof entryContent !== 'string' || Buffer.byteLength(entryContent, 'utf8') > MAX_PROTO_FILE_BYTES) {
    throw Error('Main .proto must be UTF-8 and at most 128 KiB.');
  }
  const files = new Map([[entryName, entryContent]]);
  let total = Buffer.byteLength(entryContent, 'utf8');
  for (const item of fileList) {
    if (!item || typeof item !== 'object') throw Error('Invalid .proto dependency.');
    const name = validateProtoName(item.name);
    if (files.has(name) || typeof item.content !== 'string') throw Error('Duplicate .proto path or invalid file contents: ' + name);
    const size = Buffer.byteLength(item.content, 'utf8');
    if (size > MAX_PROTO_FILE_BYTES) throw Error('Dependency exceeds 128 KiB: ' + name);
    total += size;
    files.set(name, item.content);
  }
  if (total > MAX_PROTO_TOTAL_BYTES) throw Error('Total .proto files exceed 512 KiB.');

  const root = new protobuf.Root();
  const parsed = new Set();
  const active = new Set();
  function load(name) {
    if (parsed.has(name)) return;
    if (active.has(name)) return; // Import cycles do not require duplicate declarations.
    const source = files.get(name);
    if (source === undefined) throw Error('Missing imported .proto: ' + name);
    active.add(name);
    const description = protobuf.parse(source, { keepCase: true });
    const imports = [...(description.imports || []), ...(description.publicImports || []), ...(description.weakImports || [])];
    for (const imported of imports) {
      if (typeof imported !== 'string' || imported.startsWith('/') || imported.includes('\\')) {
        throw Error('Absolute or invalid .proto import: ' + imported);
      }
      const absolute = path.posix.normalize(path.posix.join('/', path.posix.dirname(name), imported));
      const resolved = absolute.slice(1);
      validateProtoName(resolved);
      load(resolved);
    }
    protobuf.parse(source, root, { keepCase: true });
    parsed.add(name); active.delete(name);
  }
  load(entryName);
  root.resolveAll();
  return root;
}
