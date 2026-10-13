import { useEffect, useRef, useState } from 'react';
import { Copy, FileUp, Play, ShieldAlert, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { Collection, GrpcRequestPreset } from '../types';
import { consumeGrpcStream, type GrpcStreamEvent } from '../lib/grpc-stream';
import { LOCAL_AGENT_URL } from '../lib/request';

type GrpcResult = { status: number; statusText: string; duration: number; response: unknown };
type Props = { agentToken: string; onPair: () => void; collections: Collection[];
  defaultCollectionId?: string; preset?: GrpcRequestPreset;
  onSave: (preset: GrpcRequestPreset) => Promise<void>; onDelete: (id: string) => Promise<void> };
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

export function GrpcConsole({ agentToken, onPair, collections, defaultCollectionId, preset, onSave, onDelete }: Props) {
  const [presetId, setPresetId] = useState(preset?.id);
  const [presetName, setPresetName] = useState(preset?.name || 'New gRPC request');
  const [collectionId, setCollectionId] = useState(preset?.collectionId || defaultCollectionId || collections[0]?.id || '');
  const [callMode, setCallMode] = useState<GrpcRequestPreset['callMode']>(preset?.callMode || 'unary');
  const [streamEvents, setStreamEvents] = useState<GrpcStreamEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [halfClosed, setHalfClosed] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [target, setTarget] = useState(preset?.target || 'grpc://127.0.0.1:50051');
  const [proto, setProto] = useState(preset?.proto ?? EXAMPLE_PROTO);
  const [entryName, setEntryName] = useState(preset?.entryName || 'main.proto');
  const [protoFiles, setProtoFiles] = useState<ProtoFile[]>(preset?.protoFiles || []);
  const [source, setSource] = useState<'files' | 'reflection'>(preset?.source || 'files');
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [reflectedMethods, setReflectedMethods] = useState<ReflectedMethod[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [service, setService] = useState(preset?.service || 'demo.Greeter');
  const [method, setMethod] = useState(preset?.method || 'SayHello');
  const [message, setMessage] = useState(preset?.message || '{\n  "name": "ReqDock"\n}');
  const [metadata, setMetadata] = useState(preset?.metadata || '{}');
  const [error, setError] = useState('');
  const [result, setResult] = useState<GrpcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { controller.current?.abort(); }, []); // Stop active RPC on modal close/unmount.

  async function savePreset() {
    if (!collectionId || !collections.some(c => c.id === collectionId)) { setError('Select a collection first.'); return; }
    if (!presetName.trim()) { setError('Enter a preset name.'); return; }
    const id = presetId || crypto.randomUUID();
    const model: GrpcRequestPreset = { id, name:presetName.trim(), collectionId, updatedAt:Date.now(),
      target, proto, protoFiles, entryName, source, service, method, message, metadata, callMode };
    try {
      await onSave(model); setPresetId(id); setError(''); setStreamStatus('Saved to collection.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save gRPC request.'); }
  }
  async function deletePreset() {
    if (!presetId || !window.confirm('Delete this saved gRPC request?')) return;
    try { await onDelete(presetId); } catch { setError('Could not delete saved request.'); }
  }

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
        const available = data.methods?.[0];
        if (available && !data.methods?.some(item => item.name === method)) {
          setMethod(available.name);
          setCallMode(available.requestStream ? (available.responseStream ? 'bidi' : 'client-stream')
            : available.responseStream ? 'server-stream' : 'unary');
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Service discovery failed.');
    } finally { setDiscovering(false); }
  }

  const isInteractive = callMode === 'client-stream' || callMode === 'bidi';
  const sessionHeaders = { 'Content-Type':'application/json', 'X-ReqDock-Agent-Token':agentToken };
  const rpcPayload = (requestMetadata: unknown, requestBody?: unknown) => ({
    target, proto:source === 'files' ? proto : undefined,
    protoFiles:source === 'files' ? protoFiles : undefined,
    entryName:source === 'files' ? entryName : undefined,
    useReflection:source === 'reflection', service, method, metadata:requestMetadata,
    ...(requestBody === undefined ? {} : {message:requestBody}),
  });

  async function startInteractive() {
    if (sessionRef.current || loading) return;
    setError(''); setResult(null); setStreamEvents([]); setStreamStatus('');
    if (!agentToken) { setError('Pair with Local Agent first.'); return; }
    let requestMetadata: unknown;
    try { requestMetadata = JSON.parse(metadata); }
    catch { setError('Metadata must contain a JSON object.'); return; }
    if (!requestMetadata || typeof requestMetadata !== 'object' || Array.isArray(requestMetadata)) {
      setError('Metadata must contain a JSON object.'); return;
    }
    const ctrl = new AbortController(); controller.current = ctrl;
    setLoading(true); setHalfClosed(false); setSentCount(0);
    let id: string | null = null;
    try {
      const start = await fetch(LOCAL_AGENT_URL + '/grpc/session', {
        method:'POST', headers:sessionHeaders, signal:ctrl.signal,
        body:JSON.stringify(rpcPayload(requestMetadata)), cache:'no-store',
      });
      const data = await start.json() as {id?:string; error?:string};
      if (!start.ok || !data.id) throw Error(data.error || 'Could not start interactive gRPC stream.');
      id = data.id; sessionRef.current = id; setSessionId(id);
      setStreamStatus('Connected · send messages, then Half-close to finish.');
      const events = await fetch(LOCAL_AGENT_URL + '/grpc/session/' + id + '/events', {
        headers:{'X-ReqDock-Agent-Token':agentToken}, signal:ctrl.signal, cache:'no-store',
      });
      if (!events.ok || !events.body) throw Error('Cannot subscribe to gRPC stream events.');
      await consumeGrpcStream(events.body, event => {
        if (event.type === 'message') setStreamEvents(old => [...old, event]);
        else if (event.type === 'error') { setError(event.error); setStreamStatus('Stream failed'); }
        else setStreamStatus('Completed: ' + event.count + ' messages · ' + event.duration + ' ms');
      });
    } catch (error) {
      if (!ctrl.signal.aborted) setError(error instanceof Error ? error.message : 'gRPC session failed.');
    } finally {
      if (id && !ctrl.signal.aborted) {
        // Even completed sessions may remain briefly for event replay; no further messages are sent.
      }
      sessionRef.current = null; setSessionId(null); setLoading(false); controller.current = null;
    }
  }

  async function streamCommand(action: 'message' | 'finish' | 'cancel') {
    const id = sessionRef.current;
    if (!id) return;
    if (sendingMessage && action !== 'cancel') return;
    if (action === 'message' && halfClosed) return;
    setSendingMessage(true);
    try {
      let body: unknown = {};
      if (action === 'message') {
        body = { message:JSON.parse(message) };
        if (!body || typeof body !== 'object' || !('message' in body) ||
            !body.message || typeof body.message !== 'object' || Array.isArray(body.message))
          throw Error('Each stream message must be a JSON object.');
      }
      const response = await fetch(LOCAL_AGENT_URL + '/grpc/session/' + id + '/' + action, {
        method:'POST', headers:sessionHeaders, body:JSON.stringify(body), cache:'no-store',
      });
      const result = await response.json() as {error?:string; sent?:number};
      if (!response.ok) throw Error(result.error || 'Stream command failed.');
      if (action === 'message') { setSentCount(result.sent || 0); setStreamStatus('Sent ' + result.sent + ' message(s)'); }
      if (action === 'finish') { setHalfClosed(true); setStreamStatus('Sending finished · awaiting response'); }
      if (action === 'cancel') { controller.current?.abort(); setStreamStatus('Cancelled'); }
    } catch (error) { setError(error instanceof Error ? error.message : 'Stream command failed.'); }
    finally { setSendingMessage(false); }
  }

  async function invoke() {
    if (loading) { controller.current?.abort(); return; }
    setError(''); setResult(null); setStreamEvents([]); setStreamStatus('');
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
      const response = await fetch(LOCAL_AGENT_URL + (callMode === 'server-stream' ? '/grpc/stream' : '/grpc/unary'), {
        method: 'POST', signal: cancel.signal,
        headers: { 'Content-Type': 'application/json', 'X-ReqDock-Agent-Token': agentToken },
        body: JSON.stringify({ target, proto: source === 'files' ? proto : undefined,
          protoFiles: source === 'files' ? protoFiles : undefined, entryName: source === 'files' ? entryName : undefined,
          useReflection: source === 'reflection', service, method, message: requestBody, metadata: requestMetadata }),
        cache: 'no-store',
      });
      if (callMode === 'server-stream') {
        if (!response.ok || !response.body) throw Error('Unable to establish server stream (HTTP ' + response.status + ').');
        await consumeGrpcStream(response.body, event => {
          if (event.type === 'message') setStreamEvents(old => [...old, event]);
          else if (event.type === 'error') { setError(event.error); setStreamStatus('Stream failed'); }
          else setStreamStatus('Completed: ' + event.count + ' messages · ' + event.duration + ' ms');
        });
      } else {
        const data = await response.json() as GrpcResult & { error?: string };
        if (!response.ok) throw Error(data.error || 'Local Agent returned HTTP ' + response.status);
        setResult(data);
      }
    } catch (cause) {
      setError(cancel.signal.aborted ? 'gRPC call cancelled.' :
        cause instanceof TypeError ? 'Cannot connect to Local Agent. Verify it is running and your browser permits local network access.' :
        cause instanceof Error ? cause.message : 'gRPC request failed.');
    } finally {
      setLoading(false); controller.current = null;
    }
  }

  return <div className="grpc-console">
    <p className="modal-note">All four gRPC call modes via paired Local Agent. Interactive client and bidirectional streams support Send, Half-close and Cancel; sessions expire automatically. Limits: 100 messages, 2 MiB preview, 25 seconds.</p>
    <div className="grpc-save-row">
      <input className="form-input" aria-label="Saved gRPC name" placeholder="gRPC request name" value={presetName} onChange={e => setPresetName(e.target.value)} />
      <select className="form-input" aria-label="gRPC collection" value={collectionId} onChange={e => setCollectionId(e.target.value)}>
        {collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
      </select>
      <button className="button outlined" onClick={() => void savePreset()}><Save size={14}/> Save</button>
      {presetId && <button className="icon-button" aria-label="Delete saved gRPC request" title="Delete saved gRPC request" onClick={() => void deletePreset()}><Trash2 size={15}/></button>}
    </div>
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
          onChange={e => { setMethod(e.target.value); const item = reflectedMethods.find(x => x.name === e.target.value);
            if (item) setCallMode(item.requestStream ? (item.responseStream ? 'bidi' : 'client-stream')
              : item.responseStream ? 'server-stream' : 'unary'); }}>
          <option value="">Select method...</option>
          {reflectedMethods.map(item => <option key={item.name} value={item.name}>
            {item.name}{item.requestStream ? (item.responseStream ? ' (bidirectional)' : ' (client stream)')
              : item.responseStream ? ' (server stream)' : ' (unary)'}
          </option>)}
        </select>
      </label>}
      <p className="modal-note">Reflection requires the target gRPC service to expose the standard reflection API. Uses the same exact Agent host allowlist and metadata.</p>
    </div>}
    <div className="grpc-two-col">
      <label className="field-label">Request body (JSON)<textarea className="modal-textarea grpc-json" spellCheck={false} aria-label="gRPC request JSON" value={message} onChange={e => setMessage(e.target.value)} /></label>
      <label className="field-label">Metadata (JSON)<textarea className="modal-textarea grpc-json" spellCheck={false} aria-label="gRPC metadata JSON" value={metadata} onChange={e => setMetadata(e.target.value)} /></label>
    </div>
    <label className="field-label grpc-mode-label">Call mode
      <select className="form-input" aria-label="gRPC call mode" value={callMode} disabled={loading} onChange={e => setCallMode(e.target.value as GrpcRequestPreset['callMode'])}>
        <option value="unary">Unary RPC</option><option value="server-stream">Server Streaming</option>
        <option value="client-stream">Client Streaming</option><option value="bidi">Bidirectional Streaming</option>
      </select>
    </label>
    {isInteractive && <div className="grpc-session-controls">
      <div className="grpc-session-state" role="status">{sessionId ? 'Session active' : 'No active session'} · {sentCount} messages sent{halfClosed ? ' · sending closed' : ''}</div>
      <button className="button outlined" disabled={!agentToken || loading} onClick={() => void startInteractive()}><Play size={14}/> Start session</button>
      <button className="button primary" disabled={!sessionId || halfClosed || sendingMessage} onClick={() => void streamCommand('message')}>Send message</button>
      <button className="button outlined" disabled={!sessionId || halfClosed || sendingMessage} onClick={() => void streamCommand('finish')}>Half-close</button>
      <button className="button outlined danger" disabled={!sessionId} onClick={() => void streamCommand('cancel')}>Cancel</button>
    </div>}
    {!isInteractive && <div className="modal-footer grpc-actions"><span className="modal-note">Use <code>grpc://</code> or <code>grpcs://</code>. Host must be allowlisted in Agent.</span><button className="button primary" disabled={!agentToken} onClick={() => void invoke()}><Play size={14} /> {loading ? 'Cancel' : 'Invoke RPC'}</button></div>}
    {(streamEvents.length > 0 || streamStatus) && <div className="grpc-output" aria-label="gRPC stream output">
      <div className="grpc-output-title"><strong>Stream messages ({streamEvents.length})</strong><span>{streamStatus || (loading ? 'Streaming...' : '')}</span></div>
      <div className="grpc-stream-messages">{streamEvents.map(event => event.type === 'message' &&
        <div className="grpc-stream-item" key={event.index}><small>#{event.index}</small><pre>{JSON.stringify(event.data, null, 2)}</pre></div>)}</div>
    </div>}
    {(error || result) && <div className="grpc-output" role="status">
      <div className="grpc-output-title"><strong>{error ? 'RPC failed' : 'gRPC OK'}</strong>{result && <><span>{result.duration} ms</span><button className="icon-button subtle" aria-label="Copy gRPC response" onClick={() => void navigator.clipboard.writeText(JSON.stringify(result.response, null, 2))}><Copy size={14}/></button></>}</div>
      {error ? <p className="grpc-error">{error}</p> : <pre aria-label="gRPC response JSON">{JSON.stringify(result?.response, null, 2)}</pre>}
    </div>}
  </div>;
}
