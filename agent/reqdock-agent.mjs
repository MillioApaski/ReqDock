#!/usr/bin/env node
/**
 * ReqDock Local Agent, Node.js 22+; no third-party dependencies.
 * Bind ONLY to 127.0.0.1, require an ephemeral access token and exact Origin.
 * Destination hostnames are explicitly allowlisted. Never listen on 0.0.0.0.
 */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { callGrpcUnary, discoverGrpcServices } from './grpc.mjs';
import { streamGrpcServer } from './grpc-stream.mjs';

const DEFAULT_PORT = 47831;
const DEFAULT_ORIGINS = ['https://reqdock.convert-alpha.cc', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173'];
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const HOP_HEADERS = /^(host|connection|content-length|transfer-encoding|upgrade|keep-alive|te|trailer|proxy-.*|cf-.*|x-forwarded-.*|sec-.*)$/i;
const MAX_REQUEST = 4 * 1024 * 1024;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const TIMEOUT_MS = 25000;

const fail = (res, code, message, headers = {}) => json(res, code, { error: message }, headers);
function json(res, status, value, headers = {}) {
  const text = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(text);
}
export function canonicalHost(value) {
  const raw = value.trim();
  if (!raw || raw.includes('/') || raw.includes('@') || raw.includes('*') || raw.includes('?') || raw.includes('#')) throw Error('Host entries must be exact DNS names or IP addresses.');
  const url = new URL('http://' + raw);
  if (url.port || url.username || url.password || url.pathname !== '/' || !url.hostname) throw Error('Invalid allowlisted hostname.');
  return url.hostname.toLowerCase();
}
export function hostAllowed(url, allowedHosts) {
  return allowedHosts.has(url.hostname.toLowerCase());
}
const isText = type => /^(text\/|application\/(json|xml|graphql|javascript|problem\+json|[^;]+\+json|[^;]+\+xml))|image\/svg\+xml/i.test(type) || !type;
async function limitedStream(stream, limit) {
  if (!stream) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      if (typeof stream.cancel === 'function') await stream.cancel().catch(() => {});
      throw Error('SIZE_LIMIT');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
function constantTimeEquals(provided, secret) {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
function inspectPayload(payload, allowedHosts, ownPort) {
  if (!payload || typeof payload !== 'object' || typeof payload.url !== 'string') throw Error('Missing request URL.');
  const url = new URL(payload.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Only HTTP(S) URLs without embedded credentials are supported.');
  if (!hostAllowed(url, allowedHosts)) throw Error('Destination host is not allowlisted. Restart the agent with --allow-hosts=HOST.');
  if (['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port || (url.protocol === 'https:' ? '443' : '80')) === ownPort) throw Error('Agent cannot proxy itself.');
  const method = String(payload.method || 'GET').toUpperCase();
  if (!METHODS.has(method)) throw Error('Unsupported HTTP method.');
  if (payload.body != null && typeof payload.body !== 'string') throw Error('Body must be a string.');
  const headers = new Headers();
  if (payload.headers != null && (typeof payload.headers !== 'object' || Array.isArray(payload.headers))) throw Error('Invalid headers.');
  for (const [key, value] of Object.entries(payload.headers || {})) {
    if (HOP_HEADERS.test(key)) continue;
    if (typeof value !== 'string') throw Error('Headers must contain string values.');
    headers.set(key, value);
  }
  let body;
  if (payload.multipart != null) {
    const { fields, files = [] } = payload.multipart;
    if (!Array.isArray(fields) || fields.length > 100 || !Array.isArray(files) || files.length > 1) throw Error('Invalid multipart data.');
    const form = new FormData();
    for (const field of fields) {
      if (!field || typeof field.name !== 'string' || typeof field.value !== 'string') throw Error('Invalid multipart field.');
      form.append(field.name, field.value);
    }
    for (const file of files) {
      if (!file || typeof file.name !== 'string' || typeof file.filename !== 'string' ||
          typeof file.contentType !== 'string' || typeof file.base64 !== 'string' ||
          file.base64.length > MAX_BODY * 1.4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) {
        throw Error('Invalid multipart file.');
      }
      const bytes = Buffer.from(file.base64, 'base64');
      if (bytes.length > MAX_BODY) throw Error('File exceeds the 2 MiB limit.');
      form.append(file.name, new Blob([bytes], { type: file.contentType }), file.filename);
    }
    headers.delete('content-type');
    body = form;
  } else if (payload.body != null) {
    if (Buffer.byteLength(payload.body, 'utf8') > MAX_BODY) throw Error('Request body exceeds 2 MiB.');
    body = payload.body;
  }
  if (['GET', 'HEAD'].includes(method)) body = undefined;
  return { url, method, headers, body };
}
export function createAgent({ port = DEFAULT_PORT, token = randomBytes(32).toString('base64url'),
  allowedHosts = ['localhost', '127.0.0.1', '[::1]'], allowedOrigins = DEFAULT_ORIGINS } = {}) {
  const hosts = new Set(allowedHosts.map(canonicalHost));
  const origins = new Set(allowedOrigins.map(s => new URL(s).origin));
  const server = createServer(async (req, res) => {
    // Validate Host even for OPTIONS to block DNS-rebinding / cross-site attacks.
    const listenPort = server.address()?.port || port;
    if (req.headers.host !== '127.0.0.1:' + listenPort) return fail(res, 403, 'Use http://127.0.0.1 to contact the local agent.');
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return fail(res, 403, 'Browser origin not allowed.');
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-ReqDock-Agent-Token',
        'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '300', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (!constantTimeEquals(req.headers['x-reqdock-agent-token'], token)) return fail(res, 401, 'Invalid Local Agent token.', cors);
    if (req.method === 'GET' && req.url === '/status') return json(res, 200, { ok: true, version: '1.1.0', allowedHosts: [...hosts] }, cors);
    if (req.method !== 'POST' || !['/request', '/grpc/unary', '/grpc/discover', '/grpc/stream'].includes(req.url)) return fail(res, 404, 'Not found.', cors);
    let data;
    try { data = JSON.parse((await limitedStream(req, MAX_REQUEST)).toString('utf8')); }
    catch (error) { return fail(res, error?.message === 'SIZE_LIMIT' ? 413 : 400, 'Invalid or oversized request JSON.', cors); }
    if (req.url === '/grpc/stream') {
      // application/x-ndjson keeps streaming responses incremental without a
      // WebSocket server or buffering untrusted upstream output in memory.
      res.writeHead(200, { ...cors, 'Content-Type':'application/x-ndjson; charset=utf-8',
        'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
      const abort = new AbortController();
      const disconnect = () => abort.abort();
      res.on('close', disconnect);
      try {
        await streamGrpcServer(data, { allowedHosts:hosts, agentPort:listenPort },
          event => {
            if (res.destroyed || res.writableEnded) return false;
            return res.write(JSON.stringify(event) + '\n');
          }, abort.signal);
      } catch (error) {
        if (!res.destroyed && !res.writableEnded)
          res.write(JSON.stringify({ type:'error', error:error instanceof Error ? error.message : 'gRPC stream failed.' }) + '\n');
      } finally {
        res.off('close', disconnect);
        if (!res.destroyed && !res.writableEnded) res.end();
      }
      return;
    }
    if (req.url === '/grpc/discover') {
      try {
        const response = await discoverGrpcServices(data, { allowedHosts: hosts, agentPort: listenPort });
        return json(res, 200, response, cors);
      } catch (error) {
        return fail(res, 400, error instanceof Error ? error.message : 'gRPC discovery failed.', cors);
      }
    }
    if (req.url === '/grpc/unary') {
      try {
        const response = await callGrpcUnary(data, { allowedHosts: hosts, agentPort: listenPort });
        return json(res, 200, response, cors);
      } catch (error) {
        return fail(res, 400, error instanceof Error ? error.message : 'gRPC invocation failed.', cors);
      }
    }
    let prepared;
    try { prepared = inspectPayload(data, hosts, listenPort); }
    catch (error) { return fail(res, 400, error instanceof Error ? error.message : 'Invalid request.', cors); }
    try {
      const started = performance.now();
      const upstream = await fetch(prepared.url, { method: prepared.method, headers: prepared.headers, body: prepared.body,
        redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (Number(upstream.headers.get('content-length') || 0) > MAX_RESPONSE) return fail(res, 413, 'Response exceeds 2 MiB.', cors);
      let bytes;
      try { bytes = await limitedStream(upstream.body, MAX_RESPONSE); }
      catch { return fail(res, 413, 'Response exceeds 2 MiB.', cors); }
      const contentType = upstream.headers.get('content-type') || '';
      const textual = isText(contentType);
      return json(res, 200, {
        status: upstream.status, statusText: upstream.statusText,
        headers: [...upstream.headers].map(([key, value]) => ({ id: randomUUID(), key, value, enabled: true })),
        setCookies: upstream.headers.getSetCookie?.() || [],
        text: textual ? bytes.toString('utf8') : '',
        bodyBase64: textual ? undefined : bytes.toString('base64'),
        contentType, size: bytes.length, duration: Math.round(performance.now() - started),
        redirected: upstream.status >= 300 && upstream.status < 400,
      }, cors);
    } catch { return fail(res, 502, 'Upstream request failed or timed out. Check the destination, TLS and network.', cors); }
  });
  return { server, token, hosts, origins };
}
function parseArgs(args) {
  const result = { port: DEFAULT_PORT, allowedHosts: ['localhost', '127.0.0.1', '[::1]'], allowedOrigins: [...DEFAULT_ORIGINS] };
  for (const arg of args) {
    if (arg.startsWith('--port=')) {
      result.port = Number(arg.slice('--port='.length));
      if (!Number.isInteger(result.port) || result.port < 1024 || result.port > 65535) throw Error('Port must be 1024–65535.');
    } else if (arg.startsWith('--allow-hosts=')) {
      result.allowedHosts.push(...arg.slice('--allow-hosts='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--allow-origins=')) {
      result.allowedOrigins.push(...arg.slice('--allow-origins='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else throw Error('Unknown argument: ' + arg);
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const settings = parseArgs(process.argv.slice(2));
    const { server, token, hosts, origins } = createAgent(settings);
    server.listen(settings.port, '127.0.0.1', () => {
      console.log('\nReqDock Local Agent (loopback only)');
      console.log('Address: http://127.0.0.1:' + settings.port);
      console.log('Pairing token (do not share): ' + token);
      console.log('Allowed targets: ' + [...hosts].join(', '));
      console.log('Allowed browser origins: ' + [...origins].join(', '));
      console.log('Keep this window open while using the Local Agent.\n');
    });
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
