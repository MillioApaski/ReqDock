import { useCallback, useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  Activity, ArrowDownToLine, Braces, Check, ChevronDown, Clock3, Cloud,
  Code2, Copy, Download, ExternalLink, FileJson, FolderOpen, Globe2, History,
  Layers2, Menu, Moon, Plus, Save, Search, Send, Settings2,
  ShieldAlert, SlidersHorizontal, Sun, Terminal, Trash2, Upload, X, Zap,
} from 'lucide-react';
import { PairEditor } from './components/PairEditor';
import { db, persistHistory } from './lib/storage';
import { downloadJson, readBackup } from './lib/export';
import { exportCurl, importCurl } from './lib/curl';
import { decodeBase64, formatJson, paramsFromUrl, prepareRequest, sendRequest, setUrlParams } from './lib/request';
import { blankPair, exampleRequest, newId, newRequest, type Environment, type HistoryItem, type HttpMethod, type KeyValue, type RequestModel, type SavedResponse, type Tab, type Transport } from './types';

type SidebarSection = 'collections' | 'history';
type Modal = 'curl' | 'environment' | 'proxy' | null;
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const methodClasses: Record<HttpMethod, string> = {
  GET: 'method-get', POST: 'method-post', PUT: 'method-put', PATCH: 'method-patch',
  DELETE: 'method-delete', HEAD: 'method-get', OPTIONS: 'method-get',
};
const formatBytes = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

export default function App() {
  const [ready, setReady] = useState(false);
  const [requests, setRequests] = useState<RequestModel[]>([]);
  const [draft, setDraft] = useState<RequestModel>(() => newRequest());
  const [params, setParams] = useState<KeyValue[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [section, setSection] = useState<SidebarSection>('collections');
  const [activeTab, setActiveTab] = useState<Tab>('params');
  const [responseTab, setResponseTab] = useState<'pretty' | 'raw' | 'headers'>('pretty');
  const [transport, setTransport] = useState<Transport>('direct');
  const [proxyKey, setProxyKey] = useState('');
  const [response, setResponse] = useState<SavedResponse | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [curlText, setCurlText] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('reqdock-theme') === 'light' ? 'light' : 'dark');
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const latestRequestRef = useRef(draft);
  latestRequestRef.current = draft;
  const selectedEnv = environments.find(e => e.id === environmentId);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500); };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        let saved = await db.requests.orderBy('updatedAt').reverse().toArray();
        if (!saved.length) { const sample = exampleRequest(); await db.requests.put(sample); saved = [sample]; }
        const [envs, previous] = await Promise.all([db.environments.toArray(), db.history.orderBy('at').reverse().limit(100).toArray()]);
        if (!mounted) return;
        setRequests(saved); setDraft(saved[0]); setParams(paramsFromUrl(saved[0].url));
        setEnvironments(envs); setHistory(previous); setReady(true);
      } catch { if (mounted) { setError('IndexedDB is unavailable. Requests will not be saved between visits.'); setReady(true); } }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('reqdock-theme', theme); }, [theme]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void db.requests.put(draft).then(() => setRequests(old => {
        const next = [...old.filter(r => r.id !== draft.id), draft];
        return next.sort((a, b) => b.updatedAt - a.updatedAt);
      })).catch(() => setError('Could not save request locally.'));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, ready]);

  const updateDraft = (patch: Partial<RequestModel>) => setDraft(old => ({ ...old, ...patch, updatedAt: Date.now() }));
  const selectRequest = (item: RequestModel) => {
    if (ready) void db.requests.put(latestRequestRef.current);
    setDraft(item); setParams(paramsFromUrl(item.url)); setResponse(null); setError(''); setSidebarOpen(false);
  };
  const addRequest = () => { const item = newRequest(); selectRequest(item); notify('New request created'); };
  const deleteRequest = async (item: RequestModel) => {
    if (!window.confirm(`Delete "${item.name}" from local storage?`)) return;
    await db.requests.delete(item.id);
    const remaining = requests.filter(r => r.id !== item.id);
    setRequests(remaining);
    if (draft.id === item.id) {
      const fallback = remaining[0] || newRequest();
      setDraft(fallback); setParams(paramsFromUrl(fallback.url));
    }
    notify('Request deleted');
  };
  const changeParams = (items: KeyValue[]) => { setParams(items); updateDraft({ url: setUrlParams(draft.url, items) }); };
  const changeUrl = (url: string) => { updateDraft({ url }); setParams(paramsFromUrl(url)); };

  const saveEnvironment = async (value: Environment) => {
    setEnvironments(old => [...old.filter(e => e.id !== value.id), value]);
    try { await db.environments.put(value); } catch { notify('Could not save environment.'); }
  };
  const newEnvironment = () => {
    const value = { id: newId(), name: 'New Environment', variables: [blankPair()] };
    void saveEnvironment(value); setEnvironmentId(value.id);
  };
  const removeEnvironment = async () => {
    if (!selectedEnv || !window.confirm(`Delete environment "${selectedEnv.name}"?`)) return;
    await db.environments.delete(selectedEnv.id);
    setEnvironments(old => old.filter(e => e.id !== selectedEnv.id)); setEnvironmentId('');
  };

  const execute = useCallback(async () => {
    if (sending) { abortRef.current?.abort(); return; }
    setError(''); setResponse(null); setResponseTab('pretty');
    let prepared;
    try { prepared = prepareRequest(draft, selectedEnv); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid request.'); return; }
    const controller = new AbortController(); abortRef.current = controller; setSending(true);
    try {
      const result = await sendRequest(prepared, transport, controller.signal, proxyKey);
      setResponse(result);
      const item: HistoryItem = { id: newId(), at: Date.now(), request: structuredClone(draft), status: result.status, duration: result.duration };
      void persistHistory(item).then(() => setHistory(old => [item, ...old].slice(0, 100)));
    } catch (cause) {
      const message = controller.signal.aborted ? 'Request cancelled.' : cause instanceof TypeError && transport === 'direct'
        ? 'Network request failed. This may be a CORS restriction. Try Cloud Proxy (requires configuration) or check the URL.'
        : cause instanceof Error ? cause.message : 'Request failed.';
      setError(message);
      const item: HistoryItem = { id: newId(), at: Date.now(), request: structuredClone(draft), error: message };
      void persistHistory(item).then(() => setHistory(old => [item, ...old].slice(0, 100)));
    } finally { abortRef.current = null; setSending(false); }
  }, [draft, selectedEnv, sending, transport, proxyKey]);
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void executeRef.current(); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  const onImportCurl = () => {
    try { const item = importCurl(curlText); selectRequest(item); setModal(null); setCurlText(''); notify('cURL imported'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not import cURL'); }
  };
  const copyCurl = () => void navigator.clipboard.writeText(exportCurl(draft)).then(() => notify('cURL copied to clipboard')).catch(() => notify('Clipboard unavailable'));
  const backup = async () => downloadJson('reqdock-backup.json', { version: 1, exportedAt: new Date().toISOString(), requests: await db.requests.toArray(), environments: await db.environments.toArray() });
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const incoming = readBackup(JSON.parse(await file.text()));
      await db.transaction('rw', db.requests, db.environments, async () => {
        await db.requests.bulkPut(incoming.requests); await db.environments.bulkPut(incoming.environments);
      });
      const saved = await db.requests.orderBy('updatedAt').reverse().toArray();
      setRequests(saved); setEnvironments(await db.environments.toArray());
      if (saved.length) selectRequest(saved[0]);
      notify(`Imported ${incoming.requests.length} requests`);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Import failed'); }
    if (importRef.current) importRef.current.value = '';
  };
  const downloadBinary = () => {
    if (!response?.bodyBase64) return;
    const bytes = decodeBase64(response.bodyBase64);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: response.contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'response.bin'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const pretty = response ? formatJson(response.text) : '';
  const filtered = requests.filter(item => `${item.name} ${item.url} ${item.method}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Layers2 size={20} strokeWidth={2.25} /></span><div className="brand-name">Req<span>Dock</span></div><span className="brand-version">BETA</span></div>
      <div className="workspace-name"><div className="workspace-avatar">W</div><div className="workspace-title"><strong>My Workspace</strong><span>Local workspace</span></div><ChevronDown size={14} /></div>
      <div className="sidebar-switch">
        <button className={section === 'collections' ? 'selected' : ''} onClick={() => setSection('collections')}><FolderOpen size={15} /> Collections</button>
        <button className={section === 'history' ? 'selected' : ''} onClick={() => setSection('history')}><History size={15} /> History</button>
      </div>
      <div className="sidebar-heading"><span>{section === 'collections' ? 'MY REQUESTS' : 'RECENT REQUESTS'}</span><button className="icon-button subtle" title="New request" onClick={addRequest}><Plus size={15} /></button></div>
      {section === 'collections' ? <>
        <div className="sidebar-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requests..." aria-label="Search requests" /></div>
        <div className="request-list">{filtered.map(item => <div className={`request-list-item ${item.id === draft.id ? 'active' : ''}`} key={item.id}>
          <button className="request-item-main" onClick={() => selectRequest(item)}><span className={`request-method ${methodClasses[item.method]}`}>{item.method}</span><span className="truncate">{item.name}</span></button>
          <button className="icon-button subtle delete-on-hover" title="Delete request" onClick={() => void deleteRequest(item)}><Trash2 size={13} /></button>
        </div>)}{!filtered.length && <div className="empty-sidebar">No matching requests</div>}</div>
      </> : <div className="request-list history-list">{history.map(item => <button className="history-item" key={item.id} onClick={() => selectRequest({ ...item.request, id: newId(), updatedAt: Date.now() })}>
        <div><span className={`request-method ${methodClasses[item.request.method]}`}>{item.request.method}</span><span className="truncate">{item.request.name}</span></div>
        <small>{new Date(item.at).toLocaleString()} <span className={item.error ? 'error-color' : 'success-color'}>{item.error ? 'Failed' : item.status}</span></small>
      </button>)}{!history.length && <div className="empty-sidebar">Requests you send will appear here</div>}</div>}
      <div className="sidebar-bottom"><div className="sidebar-bottom-title"><span className="status-dot" /> All data stays in your browser</div><p>ReqDock stores your requests and environments locally using IndexedDB.</p><a href="https://github.com/MillioApaski/ReqDock" target="_blank" rel="noreferrer"><Code2 size={14} /> View on GitHub <ExternalLink size={12} /></a></div>
    </aside>
    {sidebarOpen && <button className="backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <main className="main-panel">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-only" aria-label="Toggle menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span className="breadcrumb">Workspace</span><span className="slash">/</span><span className="breadcrumb-current">{draft.name}</span></div>
        <div className="topbar-actions"><div className="environment-picker"><Globe2 size={15} /><select aria-label="Current environment" value={environmentId} onChange={e => setEnvironmentId(e.target.value)}><option value="">No environment</option>{environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select><ChevronDown size={13} /></div><button className="icon-button" title="Edit environments" onClick={() => setModal('environment')}><SlidersHorizontal size={17} /></button><span className="topbar-divider" /><button className="icon-button" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button></div>
      </header>
      <div className="content">
        <div className="content-heading"><div><div className="eyebrow">API WORKSPACE <span className="eyebrow-dot">·</span> REQUEST BUILDER</div><div className="heading-line"><input aria-label="Request name" className="request-title" value={draft.name} onChange={e => updateDraft({ name: e.target.value })} /><span className="saved-pill"><Check size={12} /> Local</span></div><p>Compose, send, and inspect HTTP requests in one place.</p></div><div className="request-actions"><button className="button outlined" onClick={() => { void db.requests.put(draft); notify('Saved locally'); }}><Save size={15} /> Save</button><div className="dropdown"><button className="button outlined" onClick={() => setModal('curl')}><Terminal size={15} /> Import cURL</button></div><button className="icon-button" title="Copy as cURL" onClick={copyCurl}><Copy size={17} /></button></div></div>
        <section className="request-box" aria-label="Request editor">
          <div className="request-url-row"><div className="method-select-wrap"><select aria-label="HTTP method" className={methodClasses[draft.method]} value={draft.method} onChange={e => updateDraft({ method: e.target.value as HttpMethod })}>{METHODS.map(method => <option key={method}>{method}</option>)}</select><ChevronDown size={13} /></div><input className="url-input" aria-label="Request URL" spellCheck={false} placeholder="Enter request URL or {{baseUrl}}/api/..." value={draft.url} onChange={e => changeUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void execute(); }} /><button className={`send-button ${sending ? 'sending' : ''}`} onClick={() => void execute()}>{sending ? <><X size={16} /> Cancel</> : <><Send size={16} /> Send</>}</button></div>
          <div className="request-options"><div className="tab-strip" role="tablist">{(['params','headers','auth','body'] as Tab[]).map(tab => <button role="tab" aria-selected={activeTab === tab} className={`tab ${activeTab === tab ? 'active' : ''}`} key={tab} onClick={() => setActiveTab(tab)}>{tab === 'auth' ? 'Authorization' : tab.charAt(0).toUpperCase() + tab.slice(1)}{tab === 'headers' && draft.headers.filter(h => h.enabled && h.key).length > 0 && <span className="count-badge">{draft.headers.filter(h => h.enabled && h.key).length}</span>}</button>)}</div><div className="transport-toggle" title="Direct uses browser fetch; Cloud Proxy requires configuration"><button className={transport === 'direct' ? 'active' : ''} onClick={() => setTransport('direct')}><Zap size={13} /> Direct</button><button className={transport === 'proxy' ? 'active' : ''} onClick={() => setTransport('proxy')}><Cloud size={13} /> Proxy</button><button className="proxy-settings" title="Proxy settings" aria-label="Proxy settings" onClick={() => setModal('proxy')}><Settings2 size={14} /></button></div></div>
          <div className="request-editor-content">
            {activeTab === 'params' && <><div className="panel-label"><strong>Query Parameters</strong><span>Parameters are reflected in the URL above.</span></div><PairEditor items={params} onChange={changeParams} /></>}
            {activeTab === 'headers' && <><div className="panel-label"><strong>Request Headers</strong><span>Use {'{{variable}}'} to reference the active environment.</span></div><PairEditor items={draft.headers} onChange={headers => updateDraft({ headers })} /></>}
            {activeTab === 'auth' && <div className="auth-panel"><div className="panel-label"><strong>Authorization</strong><span>Credentials are saved only in your browser.</span></div><label className="field-label">Auth type</label><select className="form-input auth-select" value={draft.auth.type} onChange={e => updateDraft({ auth: { ...draft.auth, type: e.target.value as RequestModel['auth']['type'] } })}><option value="none">No Auth</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option><option value="api-key">API Key</option></select>
              {draft.auth.type === 'bearer' && <><label className="field-label">Token</label><input className="form-input" type="password" autoComplete="off" value={draft.auth.token} placeholder="{{accessToken}}" onChange={e => updateDraft({ auth: { ...draft.auth, token: e.target.value } })} /></>}
              {draft.auth.type === 'basic' && <><label className="field-label">Username</label><input className="form-input" value={draft.auth.username} onChange={e => updateDraft({ auth: { ...draft.auth, username: e.target.value } })} /><label className="field-label">Password</label><input className="form-input" type="password" autoComplete="off" value={draft.auth.password} onChange={e => updateDraft({ auth: { ...draft.auth, password: e.target.value } })} /></>}
              {draft.auth.type === 'api-key' && <><label className="field-label">Key</label><input className="form-input" value={draft.auth.key} onChange={e => updateDraft({ auth: { ...draft.auth, key: e.target.value } })} /><label className="field-label">Value</label><input className="form-input" type="password" autoComplete="off" value={draft.auth.value} onChange={e => updateDraft({ auth: { ...draft.auth, value: e.target.value } })} /><label className="field-label">Add to</label><select className="form-input auth-select" value={draft.auth.location} onChange={e => updateDraft({ auth: { ...draft.auth, location: e.target.value as 'header' | 'query' } })}><option value="header">Header</option><option value="query">Query Params</option></select></>}
            </div>}
            {activeTab === 'body' && <><div className="body-toolbar"><div className="body-types">{(['none', 'json', 'text', 'urlencoded'] as const).map(type => <label key={type}><input type="radio" checked={draft.bodyType === type} onChange={() => updateDraft({ bodyType: type })} /> {type === 'none' ? 'none' : type === 'json' ? 'JSON' : type === 'text' ? 'raw text' : 'x-www-form-urlencoded'}</label>)}</div><span>{['GET','HEAD'].includes(draft.method) ? 'GET/HEAD request bodies are not sent' : 'UTF-8'}</span></div>{draft.bodyType !== 'none' ? <CodeMirror className="body-editor" value={draft.body} height="200px" theme={theme === 'dark' ? oneDark : 'light'} extensions={draft.bodyType === 'json' ? [json()] : []} onChange={value => updateDraft({ body: value })} basicSetup={{ foldGutter: true, lineNumbers: true }} /> : <div className="no-body">This request does not have a body.</div>}</>}
          </div>
        </section>
        <div className="response-heading"><div className="response-title"><Activity size={18} /><strong>Response</strong>{response && <span className={`response-status ${response.status < 400 ? 'status-good' : 'status-bad'}`}>{response.status} {response.statusText}</span>}</div><div className="response-meta">{response && <><span><Clock3 size={13} /> {response.duration} ms</span><span><ArrowDownToLine size={13} /> {formatBytes(response.size)}</span></>}</div></div>
        <section className="response-box" aria-label="Response viewer">
          {error ? <div className="response-error"><ShieldAlert size={21} /><div><strong>Request failed</strong><p>{error}</p>{transport === 'direct' && <button className="text-link" onClick={() => setModal('proxy')}>Configure Cloud Proxy <ExternalLink size={12} /></button>}</div></div> : response ? <>
            <div className="response-toolbar"><div className="tab-strip" role="tablist">{(['pretty', 'raw', 'headers'] as const).map(tab => <button key={tab} role="tab" aria-selected={responseTab === tab} onClick={() => setResponseTab(tab)} className={`tab ${responseTab === tab ? 'active' : ''}`}>{tab === 'pretty' ? 'Pretty' : tab === 'raw' ? 'Raw' : 'Headers'}{tab === 'headers' && <span className="count-badge">{response.headers.length}</span>}</button>)}</div><div className="response-toolbar-right">{response.contentType && <span className="response-kind">{response.contentType.split(';')[0]}</span>}<button className="icon-button subtle" title="Copy response text" onClick={() => void navigator.clipboard.writeText(response.text).then(() => notify('Response copied'))}><Copy size={15} /></button></div></div>
            {responseTab === 'headers' ? <div className="response-headers">{response.headers.map(header => <div className="header-line" key={header.id}><span>{header.key}</span><span>{header.value}</span></div>)}</div> : response.bodyBase64 ? <div className="binary-content"><FileJson size={30} /><strong>Binary response</strong><p>{formatBytes(response.size)} · {response.contentType || 'application/octet-stream'}</p><button className="button outlined" onClick={downloadBinary}><Download size={15} /> Download file</button></div> : <CodeMirror className="response-editor" value={responseTab === 'pretty' ? pretty : response.text} editable={false} readOnly={true} height="min(38vh, 340px)" theme={theme === 'dark' ? oneDark : 'light'} extensions={responseTab === 'pretty' ? [json()] : []} basicSetup={{ foldGutter: true, lineNumbers: true }} />}
          </> : <div className="response-placeholder"><span className="response-placeholder-icon"><Braces size={28} /></span><strong>Ready when you are</strong><p>Send a request to view the response here.<br />Status, headers, and body will appear in this panel.</p><span className="shortcut-hint"><span>Ctrl</span> + <span>Enter</span> to send</span></div>}
        </section>
        <footer className="footer"><span><span className="status-dot" /> Local-first workspace</span><div><button onClick={() => void backup()}><Download size={13} /> Export backup</button><button onClick={() => importRef.current?.click()}><Upload size={13} /> Import backup</button><input type="file" ref={importRef} hidden accept="application/json,.json" onChange={e => void importBackup(e.target.files?.[0])} /></div></footer>
      </div>
    </main>
    {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="modal" role="dialog" aria-modal="true" aria-label={modal === 'curl' ? 'Import cURL' : modal === 'proxy' ? 'Proxy settings' : 'Environments'}><div className="modal-header"><strong>{modal === 'curl' ? 'Import cURL' : modal === 'proxy' ? 'Cloud Proxy settings' : 'Manage environments'}</strong><button className="icon-button" onClick={() => setModal(null)} title="Close"><X size={18} /></button></div>
      {modal === 'curl' && <><p className="modal-note">Paste a cURL command to populate URL, method, headers, and body. Unsupported options produce an error rather than being silently ignored.</p><textarea className="modal-textarea" placeholder={'curl -X POST https://api.example.com \\\n  -H "Content-Type: application/json" \\\n  -d \'{"hello":"world"}\''} value={curlText} onChange={e => setCurlText(e.target.value)} rows={8} /><div className="modal-footer"><button className="button outlined" onClick={() => setModal(null)}>Cancel</button><button className="button primary" onClick={onImportCurl}><Upload size={15} /> Import request</button></div></>}
      {modal === 'environment' && <><p className="modal-note">Variables can be used anywhere in a request as <code>{'{{variableName}}'}</code>. Values remain in this browser unless you export a backup.</p><div className="environment-controls"><select className="form-input" value={environmentId} onChange={e => setEnvironmentId(e.target.value)}><option value="">Select environment</option>{environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select><button className="button outlined" onClick={newEnvironment}><Plus size={14} /> New</button></div>{selectedEnv ? <><label className="field-label">Environment name</label><input className="form-input" value={selectedEnv.name} onChange={e => void saveEnvironment({ ...selectedEnv, name: e.target.value })} /><div className="environment-pairs"><PairEditor items={selectedEnv.variables} onChange={variables => void saveEnvironment({ ...selectedEnv, variables })} keyPlaceholder="Variable" valuePlaceholder="Value" /></div><button className="button danger outlined" onClick={() => void removeEnvironment()}><Trash2 size={14} /> Delete environment</button></> : <div className="modal-empty">Create or select an environment to edit its variables.</div>}<div className="modal-footer"><button className="button primary" onClick={() => setModal(null)}><Check size={15} /> Done</button></div></>}
      {modal === 'proxy' && <><div className="proxy-info"><ShieldAlert size={18} /><div><strong>Proxy is locked down by default</strong><p>Configure exact host allowlist and proxy key as Cloudflare Pages environment variables. The key entered here remains in memory and is not exported.</p></div></div><label className="field-label">Proxy key</label><input className="form-input" type="password" autoComplete="off" value={proxyKey} placeholder="REQDOCK_PROXY_KEY" onChange={e => setProxyKey(e.target.value)} /><p className="modal-note">Set <code>REQDOCK_ALLOWED_HOSTS</code> (comma-separated exact DNS names) and secret <code>REQDOCK_PROXY_KEY</code> under Pages → Settings → Variables and Secrets. Deploy with Git integration so Pages Functions is included. Direct mode requires neither.</p><div className="modal-footer"><button className="button primary" onClick={() => { setTransport('proxy'); setModal(null); }}><Check size={15} /> Use Cloud Proxy</button></div></>}
    </div></div>}
  </div>;
}
