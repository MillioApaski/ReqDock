import { useRef, useState } from 'react';
import { Copy, FileUp, Play, ShieldAlert, RefreshCw } from 'lucide-react';
import { LOCAL_AGENT_URL } from '../lib/request';

type GrpcResult = { status: number; statusText: string; duration: number; response: unknown };
type Props = { agentToken: string; onPair: () => void };
type ProtoFile = { name: string; content: string };
type ReflectedMethod = { name: string; requestStream: boolean; responseStream: boolean };

const EXAMPLE_PROTO = [
  'syntax = "proto3";',
  'package demo;',
  '',
  'service Greeter {',
  '  rpc SayHello (HelloRequest) returns (HelloReply);',
  '}',
  'message HelloRequest { string name = 1; }',
  'message HelloReply { string message = 1; }',
].join('\n');

export function GrpcConsole({ agentToken, onPair }: Props) {
  const [target, setTarget] = useState('grpc://127.0.0.1:50051');
  const [proto, setProto] = useState(EXAMPLE_PROTO);
  const [entryName, setEntryName] = useState('main.proto');
  const [protoFiles, setProtoFiles] = useState<ProtoFile[]>([]);
  const [source, setSource] = useState<'files' | 'reflection'>('files');
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [reflectedMethods, setReflectedMethods] = useState<ReflectedMethod[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [service, setService] = useState('demo.Greeter');
  const [method, setMethod] = useState('SayHello');
  const [message, setMessage] = useState('{\n  "name": "ReqDock"\n}');
  const [metadata, setMetadata] = useState('{}');
  const [error, setError] = useState('');
  const [result, setResult] = useState<GrpcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  async function importFiles(selected: FileList | null) {
    if (!selected?.length) return;
    if (selected.length > 32) { setError('Select at most 32 .proto files.'); return; }
    const list: ProtoFile[] = [];
    let total = 0;
    for (const file of Array.from(selected)) {
      const name = file.webkitRelativePath || file.name;
      if (!name.endsWith('.proto') || file.size > 128 * 1024 || /(^|\/)\.\.(\/|$)/.test(name)) {
        setError('Only relative .proto files up to 128 KiB are supported.'); return;
      }
      total += file.size;
      if (total > 512 * 1024) { setError('Proto files exceed the 512 KiB total limit.'); return; }
      list.push({ name, content: await file.text() });
    }
    const main = list[0];
    if (!main) return;
    setProto(main.content); setEntryName(main.name); setProtoFiles(list.slice(1)); setError('');
  }

  async function discover(withMethods: boolean) {
    if (!agentToken) { setError('Pair with Local Agent first.'); return; }
    let parsedMetadata: unknown;
    try { parsedMetadata = JSON.parse(metadata); } catch { setError('Metadata must be valid JSON.'); return; }
    setError(''); setDiscovering(true);
    try {
      const response = await fetch(LOCAL_AGENT_URL + '/grpc/discover', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-ReqDock-Agent-Token': agentToken },
        body: JSON.stringify({ target, metadata: parsedMetadata, ...(withMethods ? { service } : {}) }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json() as { services?: string[]; methods?: ReflectedMethod[]; error?: string };
      if (!response.ok) throw Error(data.error || 'Service reflection failed.');
      if (!withMethods) {
        const list = data.services || [];
        setDiscovered(list); setReflectedMethods([]);
        if (list.length && !list.includes(service)) setService(list[0]);
      } else {
        setReflectedMethods(data.methods || []);
        const firstUnary = data.methods?.find(item => !item.requestStream && !item.responseStream);
        if (firstUnary && !data.methods?.some(item => item.name === method)) setMethod(firstUnary.name);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Service discovery failed.');
    } finally { setDiscovering(false); }
  }

  async function invoke() {
    if (loading) { controller.current?.abort(); return; }
    setError(''); setResult(null);
    if (!agentToken) { setError('Pair with Local Agent first.'); return; }
    if (source === 'files' && new TextEncoder().encode(proto).length > 128 * 1024) { setError('.proto exceeds the 128 KiB limit.'); return; }
    let requestBody: unknown, requestMetadata: unknown;
    try {
      requestBody = JSON.parse(message);
      requestMetadata = JSON.parse(metadata);
    } catch { setError('Request and metadata must both contain valid JSON objects.'); return; }
    if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody) ||
        !requestMetadata || typeof requestMetadata !== 'object' || Array.isArray(requestMetadata)) {
      setError('Request and metadata must both contain JSON objects.'); return;
    }
    const cancel = new AbortController(); controller.current = cancel;
    setLoading(true);
    try {
      const response = await fetch(LOCAL_AGENT_URL + '/grpc/unary', {
        method: 'POST', signal: cancel.signal,
        headers: { 'Content-Type': 'application/json', 'X-ReqDock-Agent-Token': agentToken },
        body: JSON.stringify({ target, proto: source === 'files' ? proto : undefined,
          protoFiles: source === 'files' ? protoFiles : undefined, entryName: source === 'files' ? entryName : undefined,
          useReflection: source === 'reflection', service, method, message: requestBody, metadata: requestMetadata }),
        cache: 'no-store',
      });
      const data = await response.json() as GrpcResult & { error?: string };
      if (!response.ok) throw Error(data.error || 'Local Agent returned HTTP ' + response.status);
      setResult(data);
    } catch (cause) {
      setError(cancel.signal.aborted ? 'gRPC call cancelled.' :
        cause instanceof TypeError ? 'Cannot connect to Local Agent. Verify it is running and your browser permits local network access.' :
        cause instanceof Error ? cause.message : 'gRPC request failed.');
    } finally {
      setLoading(false); controller.current = null;
    }
  }

  return <div className="grpc-console">
    <p className="modal-note">Unary RPC through Local Agent. Select an uploaded Proto file set or discover services using server reflection. Imported files never reach the Agent filesystem.</p>
    <div className="grpc-source-selector" role="group" aria-label="gRPC schema source">
      <button type="button" className={source === 'files' ? 'active' : ''} onClick={() => setSource('files')}>Local .proto files</button>
      <button type="button" className={source === 'reflection' ? 'active' : ''} onClick={() => setSource('reflection')}>Server Reflection</button>
    </div>
    {!agentToken && <div className="proxy-info"><ShieldAlert size={17} /><div><strong>Agent not paired</strong><p>Run <code>npm run agent</code> locally and pair the one-time token before sending.</p><button className="button outlined" onClick={onPair}>Pair Agent</button></div></div>}
    <div className="grpc-fields">
      <label className="field-label">Target<input className="form-input" aria-label="gRPC target" spellCheck={false} value={target} placeholder="grpc://127.0.0.1:50051" onChange={e => setTarget(e.target.value)} /></label>
      <label className="field-label">Service (fully qualified)<input className="form-input" aria-label="gRPC service" spellCheck={false} value={service} placeholder="demo.Greeter" onChange={e => setService(e.target.value)} /></label>
      <label className="field-label">Method<input className="form-input" aria-label="gRPC method" spellCheck={false} value={method} onChange={e => setMethod(e.target.value)} /></label>
    </div>

    {source === 'files' ? <>
      <div className="grpc-editor-heading"><strong>Proto definitions: {entryName}{protoFiles.length ? ' + ' + protoFiles.length + ' dependencies' : ''}</strong>
        <div className="grpc-editor-buttons">
          <button className="button outlined" onClick={() => fileRef.current?.click()}><FileUp size={14} /> Choose files</button>
          <button className="button outlined" onClick={() => dirRef.current?.click()}><FileUp size={14} /> Choose folder</button>
        </div>
        <input ref={fileRef} multiple type="file" hidden accept=".proto,text/plain" aria-label="Choose proto files"
          onChange={async e => { await importFiles(e.target.files); e.target.value = ''; }} />
        <input ref={dirRef} type="file" hidden {...{ webkitdirectory: '' }} aria-label="Choose proto folder"
          onChange={async e => { await importFiles(e.target.files); e.target.value = ''; }} />
      </div>
      <textarea className="modal-textarea grpc-proto" spellCheck={false} aria-label="gRPC proto" value={proto} onChange={e => setProto(e.target.value)} />
      {!!protoFiles.length && <div className="grpc-file-list" aria-label="Imported proto dependencies">
        {protoFiles.map(item => <span key={item.name} title={item.name}>{item.name}</span>)}
      </div>}
      <p className="modal-note">Import the main .proto first; dependencies are resolved by relative path from the selected files/folder. No filesystem/network import fallback.</p>
    </> : <div className="grpc-reflection">
      <div className="grpc-reflection-actions">
        <button type="button" className="button outlined" disabled={!agentToken || discovering}
          onClick={() => void discover(false)}><RefreshCw size={14} /> {discovering ? 'Discovering...' : 'List services'}</button>
        <button type="button" className="button outlined" disabled={!agentToken || discovering || !service.trim()}
          onClick={() => void discover(true)}>Load RPC methods</button>
      </div>
      {!!discovered.length && <label className="field-label">Discovered services
        <select className="form-input" aria-label="Discovered gRPC services" value={discovered.includes(service) ? service : ''}
          onChange={e => { setService(e.target.value); setReflectedMethods([]); }}>
          <option value="">Select service...</option>
          {discovered.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>}
      {!!reflectedMethods.length && <label className="field-label">Methods
        <select className="form-input" aria-label="Discovered gRPC methods" value={reflectedMethods.some(m => m.name === method) ? method : ''}
          onChange={e => setMethod(e.target.value)}>
          <option value="">Select method...</option>
          {reflectedMethods.map(item => <option key={item.name} value={item.name} disabled={item.requestStream || item.responseStream}>
            {item.name}{item.requestStream || item.responseStream ? ' (streaming, not yet supported)' : ''}
          </option>)}
        </select>
      </label>}
      <p className="modal-note">Reflection requires the target gRPC service to expose the standard reflection API. Uses the same exact Agent host allowlist and metadata.</p>
    </div>}
    <div className="grpc-two-col">
      <label className="field-label">Request body (JSON)<textarea className="modal-textarea grpc-json" spellCheck={false} aria-label="gRPC request JSON" value={message} onChange={e => setMessage(e.target.value)} /></label>
      <label className="field-label">Metadata (JSON)<textarea className="modal-textarea grpc-json" spellCheck={false} aria-label="gRPC metadata JSON" value={metadata} onChange={e => setMetadata(e.target.value)} /></label>
    </div>
    <div className="modal-footer grpc-actions"><span className="modal-note">Plaintext <code>grpc://</code> or TLS <code>grpcs://</code>. Host must be allowlisted in Agent.</span><button className="button primary" disabled={!agentToken} onClick={() => void invoke()}><Play size={14} /> {loading ? 'Cancel' : 'Invoke RPC'}</button></div>
    {(error || result) && <div className="grpc-output" role="status">
      <div className="grpc-output-title"><strong>{error ? 'RPC failed' : 'gRPC OK'}</strong>{result && <><span>{result.duration} ms</span><button className="icon-button subtle" aria-label="Copy gRPC response" onClick={() => void navigator.clipboard.writeText(JSON.stringify(result.response, null, 2))}><Copy size={14}/></button></>}</div>
      {error ? <p className="grpc-error">{error}</p> : <pre aria-label="gRPC response JSON">{JSON.stringify(result?.response, null, 2)}</pre>}
    </div>}
  </div>;
}
