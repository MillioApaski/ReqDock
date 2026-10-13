import { useRef, useState } from 'react';
import { Copy, FileUp, Play, ShieldAlert } from 'lucide-react';
import { LOCAL_AGENT_URL } from '../lib/request';

type GrpcResult = { status: number; statusText: string; duration: number; response: unknown };
type Props = { agentToken: string; onPair: () => void };

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
  const [service, setService] = useState('demo.Greeter');
  const [method, setMethod] = useState('SayHello');
  const [message, setMessage] = useState('{\n  "name": "ReqDock"\n}');
  const [metadata, setMetadata] = useState('{}');
  const [error, setError] = useState('');
  const [result, setResult] = useState<GrpcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function invoke() {
    if (loading) { controller.current?.abort(); return; }
    setError(''); setResult(null);
    if (!agentToken) { setError('Pair with Local Agent first.'); return; }
    if (new TextEncoder().encode(proto).length > 128 * 1024) { setError('.proto exceeds the 128 KiB limit.'); return; }
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
        body: JSON.stringify({ target, proto, service, method, message: requestBody, metadata: requestMetadata }),
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
    <p className="modal-note">Unary RPC over Local Agent only. Proto definitions and request data remain in this tab. No gRPC reflection, imported .proto dependencies or streaming RPC in this version.</p>
    {!agentToken && <div className="proxy-info"><ShieldAlert size={17} /><div><strong>Agent not paired</strong><p>Run <code>npm run agent</code> locally and pair the one-time token before sending.</p><button className="button outlined" onClick={onPair}>Pair Agent</button></div></div>}
    <div className="grpc-fields">
      <label className="field-label">Target<input className="form-input" aria-label="gRPC target" spellCheck={false} value={target} placeholder="grpc://127.0.0.1:50051" onChange={e => setTarget(e.target.value)} /></label>
      <label className="field-label">Service (fully qualified)<input className="form-input" aria-label="gRPC service" spellCheck={false} value={service} placeholder="demo.Greeter" onChange={e => setService(e.target.value)} /></label>
      <label className="field-label">Method<input className="form-input" aria-label="gRPC method" spellCheck={false} value={method} onChange={e => setMethod(e.target.value)} /></label>
    </div>
    <div className="grpc-editor-heading"><strong>.proto definition</strong><button className="button outlined" onClick={() => fileRef.current?.click()}><FileUp size={14} /> Import .proto</button><input ref={fileRef} type="file" hidden accept=".proto,text/plain" aria-label="Choose proto file" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 128 * 1024) { setError('.proto file exceeds 128 KiB.'); return; }
      setProto(await file.text()); setError(''); e.target.value = '';
    }} /></div>
    <textarea className="modal-textarea grpc-proto" spellCheck={false} aria-label="gRPC proto" value={proto} onChange={e => setProto(e.target.value)} />
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
