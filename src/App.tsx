import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  Activity, ArrowDownToLine, Braces, Check, ChevronDown, Clock3, Cloud,
  Code2, Copy, Download, ExternalLink, FileJson, FolderOpen, Globe2, History,
  Layers2, Menu, Moon, Plus, Save, Search, Send, Settings2, FolderPlus, Folder as FolderIcon, Play,
  ShieldAlert, SlidersHorizontal, Sun, Terminal, Trash2, Upload, X, Zap,
} from 'lucide-react';
import { PairEditor } from './components/PairEditor';
import { db, persistHistory } from './lib/storage';
import { downloadJson, readBackup } from './lib/export';
import { exportCurl, importCurl } from './lib/curl';
import { parsePostmanCollection, exportPostmanCollection, parsePostmanEnvironment, exportPostmanEnvironment } from './lib/postman';
import { evaluateAssertions, newAssertion } from './lib/assertions';
import { runCollection, type RunResult } from './lib/runner';
import { authorizePkce } from './lib/oauth';
import { applyWorkflowScript } from './lib/script';
import { StreamConsole } from './components/StreamConsole';
import { decodeBase64, formatJson, paramsFromUrl, prepareRequest, sendRequest, setUrlParams } from './lib/request';
import { blankPair, exampleRequest, newId, newRequest, type Environment, type HistoryItem, type HttpMethod, type KeyValue, type RequestModel, type SavedResponse, type Tab, type Transport, type Collection, type Folder, type Assertion } from './types';

type SidebarSection = 'collections' | 'history';
type Modal = 'curl' | 'environment' | 'proxy' | 'runner' | 'stream' | null;
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const methodClasses: Record<HttpMethod, string> = {
  GET: 'method-get', POST: 'method-post', PUT: 'method-put', PATCH: 'method-patch',
  DELETE: 'method-delete', HEAD: 'method-get', OPTIONS: 'method-get',
};
const formatBytes = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

export default function App() {
  const [ready, setReady] = useState(false);
  const [requests, setRequests] = useState<RequestModel[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [runResults, setRunResults] = useState<RunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [runCollectionId, setRunCollectionId] = useState('');
  const runnerRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState<RequestModel>(() => newRequest());
  const [params, setParams] = useState<KeyValue[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [section, setSection] = useState<SidebarSection>('collections');
  const [activeTab, setActiveTab] = useState<Tab>('params');
  const [responseTab, setResponseTab] = useState<'pretty' | 'raw' | 'headers' | 'preview'>('pretty');
  const [transport, setTransport] = useState<Transport>('direct');
  const [proxyKey, setProxyKey] = useState('');
  const [upload, setUpload] = useState<{ fieldName: string; file: File } | undefined>(undefined);
  const [authorizing, setAuthorizing] = useState(false);
  const [response, setResponse] = useState<SavedResponse | null>(null);
  const [scriptResults, setScriptResults] = useState<ReturnType<typeof evaluateAssertions>>([]);
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
  const postmanRef = useRef<HTMLInputElement>(null);
  const latestRequestRef = useRef(draft);
  latestRequestRef.current = draft;
  const selectedEnv = environments.find(e => e.id === environmentId);
  const selectedCollection = collections.find(c => c.id === draft.collectionId);
  const testResults = response ? [...evaluateAssertions(draft.assertions || [], response), ...scriptResults] : [];

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500); };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        let saved = await db.requests.orderBy('updatedAt').reverse().toArray();
        if (!saved.length) { const sample = exampleRequest(); await db.requests.put(sample); saved = [sample]; }
        const [envs, previous] = await Promise.all([db.environments.toArray(), db.history.orderBy('at').reverse().limit(100).toArray()]);
        let existingCollections = await db.collections.toArray();
        if (!existingCollections.length) {
          const defaultCollection: Collection = { id: newId(), name: 'My Collection', createdAt: Date.now() };
          await db.collections.put(defaultCollection);
          existingCollections = [defaultCollection];
        }
        const unassigned = saved.filter(r => !r.collectionId);
        if (unassigned.length) { saved = saved.map(r => r.collectionId ? r : { ...r, collectionId: existingCollections[0].id }); await db.requests.bulkPut(saved); }
        const savedFolders = await db.folders.toArray();
        if (!mounted) return;
        setRequests(saved); setDraft(saved[0]); setParams(paramsFromUrl(saved[0].url));
        setEnvironments(envs); setHistory(previous); setCollections(existingCollections); setFolders(savedFolders); setExpanded(existingCollections.map(c => c.id).concat(savedFolders.map(f => f.id))); setRunCollectionId(existingCollections[0].id); setReady(true);
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
    setUpload(undefined);
    if (ready) void db.requests.put(latestRequestRef.current);
    setDraft(item); setParams(paramsFromUrl(item.url)); setResponse(null); setError(''); setSidebarOpen(false);
  };
  const addRequest = (collectionId = draft.collectionId, folderId = draft.folderId) => {
    const item = { ...newRequest(), collectionId: collectionId || collections[0]?.id, folderId };
    selectRequest(item); notify('New request created');
  };
  const addCollection = async () => {
    const name = window.prompt('Collection name?', 'New Collection')?.trim(); if (!name) return;
    const item: Collection = { id: newId(), name, createdAt: Date.now() };
    await db.collections.put(item); setCollections(old => [...old, item]); setExpanded(old => [...old, item.id]); setRunCollectionId(item.id);
    addRequest(item.id, undefined);
  };
  const addFolder = async (collectionId = draft.collectionId, parentId?: string) => {
    if (!collectionId) return;
    const name = window.prompt('Folder name?', 'New Folder')?.trim(); if (!name) return;
    const item: Folder = { id: newId(), name, collectionId, parentId };
    await db.folders.put(item); setFolders(old => [...old, item]); setExpanded(old => [...old, collectionId, item.id]);
  };
  const toggleExpand = (id: string) => setExpanded(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  const moveRequest = (collectionId: string, folderId?: string) => updateDraft({ collectionId, folderId });
  const renameCollection = async (collection: Collection) => {
    const name = window.prompt('Rename collection', collection.name)?.trim(); if (!name) return;
    const next = { ...collection, name };
    await db.collections.put(next); setCollections(old => old.map(c => c.id === next.id ? next : c));
  };
  const deleteCollection = async (collection: Collection) => {
    if (collections.length <= 1) { notify('Keep at least one collection'); return; }
    const target = collections.find(c => c.id !== collection.id)!;
    if (!window.confirm(`Delete collection "${collection.name}"? Its requests will move into "${target.name}".`)) return;
    const moved = requests.filter(r => r.collectionId === collection.id).map(r => ({ ...r, collectionId: target.id, folderId: undefined, updatedAt: Date.now() }));
    await db.transaction('rw', db.collections, db.folders, db.requests, async () => {
      if (moved.length) await db.requests.bulkPut(moved);
      await db.folders.where('collectionId').equals(collection.id).delete();
      await db.collections.delete(collection.id);
    });
    setRequests(old => old.map(r => r.collectionId === collection.id ? { ...r, collectionId: target.id, folderId: undefined } : r));
    setFolders(old => old.filter(f => f.collectionId !== collection.id));
    setCollections(old => old.filter(c => c.id !== collection.id));
    if (draft.collectionId === collection.id) updateDraft({ collectionId: target.id, folderId: undefined });
    if (runCollectionId === collection.id) setRunCollectionId(target.id);
  };
  const deleteFolder = async (folder: Folder) => {
    if (!window.confirm(`Delete folder "${folder.name}" and its subfolders? Requests will be moved to the collection root.`)) return;
    const descendants = new Set([folder.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of folders) if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); changed = true; }
    }
    const moved = requests.filter(r => r.folderId && descendants.has(r.folderId)).map(r => ({ ...r, folderId: undefined, updatedAt: Date.now() }));
    await db.transaction('rw', db.folders, db.requests, async () => {
      await db.folders.bulkDelete([...descendants]);
      if (moved.length) await db.requests.bulkPut(moved);
    });
    setRequests(old => old.map(r => r.folderId && descendants.has(r.folderId) ? { ...r, folderId: undefined } : r));
    if (draft.folderId && descendants.has(draft.folderId)) updateDraft({ folderId: undefined });
    setFolders(old => old.filter(f => !descendants.has(f.id)));
  };
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
    setError(''); setResponse(null); setResponseTab('pretty'); setScriptResults([]);
    let prepared;
    let workingEnv: Environment | undefined;
    try { workingEnv = applyWorkflowScript(draft.preScript || '', selectedEnv, 'before').environment; prepared = prepareRequest(draft, workingEnv); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid request.'); return; }
    const controller = new AbortController(); abortRef.current = controller; setSending(true);
    try {
      const result = await sendRequest(prepared, transport, controller.signal, proxyKey, upload);
      const after = applyWorkflowScript(draft.postScript || '', workingEnv, 'after', result);
      setResponse(result); setScriptResults(after.checks);
      if (selectedEnv) await saveEnvironment(after.environment);
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
  }, [draft, selectedEnv, sending, transport, proxyKey, upload]);
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void executeRef.current(); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  const signInOAuth = async () => {
    setAuthorizing(true);
    try {
      const token = await authorizePkce(draft.auth, transport, proxyKey);
      updateDraft({ auth: { ...draft.auth, token } });
      notify('OAuth access token received');
    } catch (error) { notify(error instanceof Error ? error.message : 'OAuth sign-in failed'); }
    finally { setAuthorizing(false); }
  };
  const onImportCurl = () => {
    try { const item = importCurl(curlText); selectRequest(item); setModal(null); setCurlText(''); notify('cURL imported'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not import cURL'); }
  };
  const copyCurl = () => void navigator.clipboard.writeText(exportCurl(draft)).then(() => notify('cURL copied to clipboard')).catch(() => notify('Clipboard unavailable'));
  const backup = async () => downloadJson('reqdock-backup.json', { version: 2, exportedAt: new Date().toISOString(), requests: await db.requests.toArray(), environments: await db.environments.toArray(), collections: await db.collections.toArray(), folders: await db.folders.toArray() });
  const importPostman = async (file?: File) => {
    if (!file) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      if (data && typeof data === 'object' && '_postman_variable_scope' in data) {
        const environment = parsePostmanEnvironment(data);
        await saveEnvironment(environment); setEnvironmentId(environment.id);
        notify(`Imported environment ${environment.name}`);
      } else {
        const imported = parsePostmanCollection(data);
        await db.transaction('rw', db.collections, db.folders, db.requests, async () => {
          await db.collections.put(imported.collection);
          await db.folders.bulkPut(imported.folders);
          await db.requests.bulkPut(imported.requests);
        });
        setCollections(old => [...old, imported.collection]);
        setFolders(old => [...old, ...imported.folders]);
        setRequests(old => [...old, ...imported.requests]);
        setExpanded(old => [...old, imported.collection.id, ...imported.folders.map(f => f.id)]);
        setRunCollectionId(imported.collection.id);
        if (imported.requests[0]) selectRequest(imported.requests[0]);
        notify(`Imported ${imported.requests.length} requests`);
      }
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Import failed'); }
    if (postmanRef.current) postmanRef.current.value = '';
  };
  const startRunner = async () => {
    if (running) { runnerRef.current?.abort(); return; }
    const queue = requests.filter(r => r.collectionId === runCollectionId);
    if (!queue.length) { notify('Collection has no requests'); return; }
    const abort = new AbortController(); runnerRef.current = abort;
    setRunning(true); setRunResults([]);
    try { await runCollection(queue, selectedEnv, transport, proxyKey, abort.signal, setRunResults, environment => { void saveEnvironment(environment); }); }
    finally { setRunning(false); runnerRef.current = null; }
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const incoming = readBackup(JSON.parse(await file.text()));
      if (!incoming.collections.length) {
        const current = collections[0] || { id: newId(), name: 'Imported', createdAt: Date.now() };
        incoming.collections = [current];
        incoming.requests = incoming.requests.map(r => ({ ...r, collectionId: r.collectionId || current.id }));
      }
      await db.transaction('rw', db.requests, db.environments, db.collections, db.folders, async () => {
        await db.requests.bulkPut(incoming.requests); await db.environments.bulkPut(incoming.environments);
        await db.collections.bulkPut(incoming.collections); await db.folders.bulkPut(incoming.folders);
      });
      const saved = await db.requests.orderBy('updatedAt').reverse().toArray();
      setRequests(saved); setEnvironments(await db.environments.toArray()); setCollections(await db.collections.toArray()); setFolders(await db.folders.toArray());
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
  const renderRequest = (item: RequestModel) => <div className={`request-list-item ${item.id === draft.id ? 'active' : ''}`} key={item.id}>
    <button className="request-item-main" onClick={() => selectRequest(item)}><span className={`request-method ${methodClasses[item.method]}`}>{item.method}</span><span className="truncate">{item.name}</span></button>
    <button className="icon-button subtle delete-on-hover" title="Delete request" onClick={() => void deleteRequest(item)}><Trash2 size={13} /></button>
  </div>;
  const renderFolders = (collectionId: string, parentId?: string, depth = 0): ReactNode => depth > 10 ? null : <>
    {folders.filter(f => f.collectionId === collectionId && f.parentId === parentId).map(folder => <div key={folder.id} className="folder-tree">
      <div className="tree-heading" style={{ paddingLeft: 10 + depth * 12 }}><button onClick={() => toggleExpand(folder.id)}><ChevronDown className={expanded.includes(folder.id) ? '' : 'collapsed'} size={13} /><FolderIcon size={14} /> <span className="truncate">{folder.name}</span></button><button className="icon-button subtle delete-on-hover" title="Add subfolder" onClick={() => void addFolder(collectionId, folder.id)}><FolderPlus size={13} /></button><button className="icon-button subtle delete-on-hover" title="Delete folder" onClick={() => void deleteFolder(folder)}><Trash2 size={13} /></button></div>
      {expanded.includes(folder.id) && <div className="tree-children" style={{ paddingLeft: (depth + 1) * 10 }}>{renderFolders(collectionId, folder.id, depth + 1)}{filtered.filter(r => r.collectionId === collectionId && r.folderId === folder.id).map(renderRequest)}</div>}
    </div>)}
  </>;


  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Layers2 size={20} strokeWidth={2.25} /></span><div className="brand-name">Req<span>Dock</span></div><span className="brand-version">BETA</span></div>
      <div className="workspace-name"><div className="workspace-avatar">W</div><div className="workspace-title"><strong>My Workspace</strong><span>Local workspace</span></div><ChevronDown size={14} /></div>
      <div className="sidebar-switch">
        <button className={section === 'collections' ? 'selected' : ''} onClick={() => setSection('collections')}><FolderOpen size={15} /> Collections</button>
        <button className={section === 'history' ? 'selected' : ''} onClick={() => setSection('history')}><History size={15} /> History</button>
      </div>
      <div className="sidebar-heading"><span>{section === 'collections' ? 'COLLECTIONS' : 'RECENT REQUESTS'}</span><div className="sidebar-actions"><button className="icon-button subtle" title="Import Postman Collection" onClick={() => postmanRef.current?.click()}><Upload size={15} /></button><button className="icon-button subtle" title="New collection" onClick={() => void addCollection()}><FolderPlus size={15} /></button><button className="icon-button subtle" title="New request" onClick={() => addRequest()}><Plus size={15} /></button></div></div>
      {section === 'collections' ? <>
        <div className="sidebar-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requests..." aria-label="Search requests" /></div>
        <div className="request-list">{collections.map(col => <div className="collection-tree" key={col.id}>
          <div className="tree-heading"><button onClick={() => toggleExpand(col.id)}><ChevronDown size={13} className={expanded.includes(col.id) ? '' : 'collapsed'} /><FolderOpen size={15} /><span className="truncate">{col.name}</span></button><button className="icon-button subtle delete-on-hover" title="Rename collection" onClick={() => void renameCollection(col)}><Settings2 size={13} /></button><button className="icon-button subtle delete-on-hover" title="Delete collection" onClick={() => void deleteCollection(col)}><Trash2 size={13} /></button><button className="icon-button subtle delete-on-hover" title="Add folder" onClick={() => void addFolder(col.id)}><FolderPlus size={14} /></button><button className="icon-button subtle delete-on-hover" title="Add request" onClick={() => addRequest(col.id, undefined)}><Plus size={14} /></button></div>
          {expanded.includes(col.id) && <div className="tree-children">{renderFolders(col.id)}{filtered.filter(r => r.collectionId === col.id && !r.folderId).map(renderRequest)}</div>}
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
        <div className="content-heading"><div><div className="eyebrow">API WORKSPACE <span className="eyebrow-dot">·</span> REQUEST BUILDER</div><div className="heading-line"><input aria-label="Request name" className="request-title" value={draft.name} onChange={e => updateDraft({ name: e.target.value })} /><span className="saved-pill"><Check size={12} /> Local</span></div><p>Compose, send, and inspect HTTP requests in one place.</p><div className="request-location"><select aria-label="Request collection" value={draft.collectionId || ''} onChange={e => moveRequest(e.target.value)}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="Request folder" value={draft.folderId || ''} onChange={e => moveRequest(draft.collectionId || '', e.target.value || undefined)}><option value="">Collection root</option>{folders.filter(f => f.collectionId === draft.collectionId).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div></div><div className="request-actions"><button className="button outlined" onClick={() => setModal('stream')}><Activity size={15} /> Live</button><button className="button outlined" onClick={() => { setModal('runner'); setRunCollectionId(draft.collectionId || collections[0]?.id || ''); }}><Play size={15} /> Run</button><button className="button outlined" onClick={() => { void db.requests.put(draft); notify('Saved locally'); }}><Save size={15} /> Save</button><div className="dropdown"><button className="button outlined" onClick={() => setModal('curl')}><Terminal size={15} /> Import cURL</button></div><button className="icon-button" title="Copy as cURL" onClick={copyCurl}><Copy size={17} /></button></div></div>
        <section className="request-box" aria-label="Request editor">
          <div className="request-url-row"><div className="method-select-wrap"><select aria-label="HTTP method" className={methodClasses[draft.method]} value={draft.method} onChange={e => updateDraft({ method: e.target.value as HttpMethod })}>{METHODS.map(method => <option key={method}>{method}</option>)}</select><ChevronDown size={13} /></div><input className="url-input" aria-label="Request URL" spellCheck={false} placeholder="Enter request URL or {{baseUrl}}/api/..." value={draft.url} onChange={e => changeUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void execute(); }} /><button className={`send-button ${sending ? 'sending' : ''}`} onClick={() => void execute()}>{sending ? <><X size={16} /> Cancel</> : <><Send size={16} /> Send</>}</button></div>
          <div className="request-options"><div className="tab-strip" role="tablist">{(['params','headers','auth','body','tests'] as Tab[]).map(tab => <button role="tab" aria-selected={activeTab === tab} className={`tab ${activeTab === tab ? 'active' : ''}`} key={tab} onClick={() => setActiveTab(tab)}>{tab === 'auth' ? 'Authorization' : tab.charAt(0).toUpperCase() + tab.slice(1)}{tab === 'headers' && draft.headers.filter(h => h.enabled && h.key).length > 0 && <span className="count-badge">{draft.headers.filter(h => h.enabled && h.key).length}</span>}</button>)}</div><div className="transport-toggle" title="Direct uses browser fetch; Cloud Proxy requires configuration"><button className={transport === 'direct' ? 'active' : ''} onClick={() => setTransport('direct')}><Zap size={13} /> Direct</button><button className={transport === 'proxy' ? 'active' : ''} onClick={() => setTransport('proxy')}><Cloud size={13} /> Proxy</button><button className="proxy-settings" title="Proxy settings" aria-label="Proxy settings" onClick={() => setModal('proxy')}><Settings2 size={14} /></button></div></div>
          <div className="request-editor-content">
            {activeTab === 'params' && <><div className="panel-label"><strong>Query Parameters</strong><span>Parameters are reflected in the URL above.</span></div><PairEditor items={params} onChange={changeParams} /></>}
            {activeTab === 'headers' && <><div className="panel-label"><strong>Request Headers</strong><span>Use {'{{variable}}'} to reference the active environment.</span></div><PairEditor items={draft.headers} onChange={headers => updateDraft({ headers })} /></>}
            {activeTab === 'auth' && <div className="auth-panel"><div className="panel-label"><strong>Authorization</strong><span>Credentials are saved only in your browser.</span></div><label className="field-label">Auth type</label><select className="form-input auth-select" value={draft.auth.type} onChange={e => updateDraft({ auth: { ...draft.auth, type: e.target.value as RequestModel['auth']['type'] } })}><option value="none">No Auth</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option><option value="api-key">API Key</option><option value="oauth2">OAuth 2.0 (Authorization Code + PKCE)</option></select>
              {draft.auth.type === 'bearer' && <><label className="field-label">Token</label><input className="form-input" type="password" autoComplete="off" value={draft.auth.token} placeholder="{{accessToken}}" onChange={e => updateDraft({ auth: { ...draft.auth, token: e.target.value } })} /></>}
              {draft.auth.type === 'basic' && <><label className="field-label">Username</label><input className="form-input" value={draft.auth.username} onChange={e => updateDraft({ auth: { ...draft.auth, username: e.target.value } })} /><label className="field-label">Password</label><input className="form-input" type="password" autoComplete="off" value={draft.auth.password} onChange={e => updateDraft({ auth: { ...draft.auth, password: e.target.value } })} /></>}
              {draft.auth.type === 'oauth2' && <><p className="modal-note">Register redirect URI <code>{window.location.origin}/oauth-callback.html</code> with your OAuth provider. Public clients only: Authorization Code + PKCE, no client secret. Token exchange requires destination CORS or an allowlisted Cloud Proxy.</p>
                {([['authorizationUrl', 'Authorization URL'], ['tokenUrl', 'Token URL'], ['clientId', 'Client ID'], ['scope', 'Scopes']] as const).map(([field, label]) => <div key={field}><label className="field-label">{label}</label><input className="form-input" value={draft.auth[field] || ''} onChange={e => updateDraft({ auth: { ...draft.auth, [field]: e.target.value } })} /></div>)}
                <label className="field-label">Access token</label><input className="form-input" type="password" autoComplete="off" value={draft.auth.token} onChange={e => updateDraft({ auth: { ...draft.auth, token: e.target.value } })} />
                <button className="button outlined" onClick={() => void signInOAuth()} disabled={authorizing}>{authorizing ? 'Authorizing...' : 'Get access token with PKCE'}</button>
              </>}
              {draft.auth.type === 'api-key' && <><label className="field-label">Key</label><input className="form-input" value={draft.auth.key} onChange={e => updateDraft({ auth: { ...draft.auth, key: e.target.value } })} /><label className="field-label">Value</label><input className="form-input" type="password" autoComplete="off" value={draft.auth.value} onChange={e => updateDraft({ auth: { ...draft.auth, value: e.target.value } })} /><label className="field-label">Add to</label><select className="form-input auth-select" value={draft.auth.location} onChange={e => updateDraft({ auth: { ...draft.auth, location: e.target.value as 'header' | 'query' } })}><option value="header">Header</option><option value="query">Query Params</option></select></>}
            </div>}
            {activeTab === 'tests' && <div className="tests-panel"><div className="panel-label"><strong>Response assertions</strong><span>Safe declarative checks (no arbitrary JavaScript execution)</span></div>
              {(draft.assertions || []).map(rule => <div key={rule.id} className="assertion-row"><select className="form-input" value={rule.kind} onChange={e => updateDraft({ assertions: (draft.assertions || []).map(x => x.id === rule.id ? { ...x, kind: e.target.value as Assertion['kind'] } : x) })}><option value="status">Status equals</option><option value="duration">Duration ≤ ms</option><option value="json">JSON path equals</option><option value="header">Header equals</option><option value="contains">Body contains</option></select><input className="form-input" placeholder={rule.kind === 'json' ? 'data.id' : rule.kind === 'header' ? 'Content-Type' : 'Target (optional)'} disabled={!['json','header'].includes(rule.kind)} value={rule.target} onChange={e => updateDraft({ assertions: (draft.assertions || []).map(x => x.id === rule.id ? { ...x, target: e.target.value } : x) })} /><input className="form-input" placeholder="Expected value" value={rule.expected} onChange={e => updateDraft({ assertions: (draft.assertions || []).map(x => x.id === rule.id ? { ...x, expected: e.target.value } : x) })} /><button className="icon-button" title="Remove assertion" onClick={() => updateDraft({ assertions: (draft.assertions || []).filter(x => x.id !== rule.id) })}><Trash2 size={15} /></button></div>)}
              <button className="button outlined" onClick={() => updateDraft({ assertions: [...draft.assertions || [], newAssertion()] })}><Plus size={14} /> Add assertion</button>
              <div className="script-editors"><label className="field-label">Before request</label><textarea className="form-input script-textarea" spellCheck={false} value={draft.preScript || ''} onChange={e => updateDraft({ preScript: e.target.value })} placeholder={'# Dynamic request variables\nset requestId={{$guid}}'} /><label className="field-label">After response</label><textarea className="form-input script-textarea" spellCheck={false} value={draft.postScript || ''} onChange={e => updateDraft({ postScript: e.target.value })} placeholder={'# Extract a token and verify response\ncapture token=json.access_token\nexpect status=200'} /><p className="modal-note">Safe workflow commands: <code>set key=value</code>, <code>unset key</code>, <code>capture key=json.path</code>, <code>expect status=200</code>, <code>expect header.Content-Type=application/json</code>. No JavaScript execution.</p></div>
              {response && <div className="assertion-results">{testResults.map((result, i) => <div key={result.id} className={result.passed ? 'success-color' : 'error-color'}>{result.passed ? '✓' : '✕'} #{i + 1} {result.label} <small>actual: {result.actual}</small></div>)}</div>}
            </div>}
            {activeTab === 'body' && <><div className="body-toolbar"><div className="body-types">{(['none', 'json', 'text', 'urlencoded', 'graphql', 'form-data'] as const).map(type => <label key={type}><input type="radio" checked={draft.bodyType === type} onChange={() => updateDraft({ bodyType: type })} /> {type === 'none' ? 'none' : type === 'json' ? 'JSON' : type === 'text' ? 'raw text' : type === 'urlencoded' ? 'x-www-form-urlencoded' : type === 'graphql' ? 'GraphQL' : 'form-data'}</label>)}</div><span>{['GET','HEAD'].includes(draft.method) ? 'GET/HEAD request bodies are not sent' : 'UTF-8'}</span></div>{draft.bodyType !== 'none' ? <CodeMirror className="body-editor" value={draft.body} height="200px" theme={theme === 'dark' ? oneDark : 'light'} extensions={draft.bodyType === 'json' ? [json()] : []} onChange={value => updateDraft({ body: value })} basicSetup={{ foldGutter: true, lineNumbers: true }} /> : <div className="no-body">This request does not have a body.</div>}{draft.bodyType === 'graphql' && <><label className="field-label">GraphQL variables (JSON)</label><textarea className="form-input graphql-variables" value={draft.graphqlVariables || '{}'} onChange={e => updateDraft({ graphqlVariables: e.target.value })} /></>}{draft.bodyType === 'form-data' && <><p className="modal-note">One form field per line: name=value. Optional file attachment is kept only in memory.</p><div className="file-upload-row"><input className="form-input" aria-label="Form file field name" placeholder="File field name" value={upload?.fieldName || 'file'} onChange={e => setUpload(old => old ? { ...old, fieldName: e.target.value } : old)} /><input aria-label="Choose upload file" type="file" onChange={e => { const file = e.target.files?.[0]; setUpload(file ? { fieldName: upload?.fieldName || 'file', file } : undefined); }} />{upload && <span>{formatBytes(upload.file.size)}</span>}</div></>}</>}
          </div>
        </section>
        <div className="response-heading"><div className="response-title"><Activity size={18} /><strong>Response</strong>{response && <span className={`response-status ${response.status < 400 ? 'status-good' : 'status-bad'}`}>{response.status} {response.statusText}</span>}</div><div className="response-meta">{response && <><span><Clock3 size={13} /> {response.duration} ms</span><span><ArrowDownToLine size={13} /> {formatBytes(response.size)}</span></>}</div></div>
        <section className="response-box" aria-label="Response viewer">
          {error ? <div className="response-error"><ShieldAlert size={21} /><div><strong>Request failed</strong><p>{error}</p>{transport === 'direct' && <button className="text-link" onClick={() => setModal('proxy')}>Configure Cloud Proxy <ExternalLink size={12} /></button>}</div></div> : response ? <>
            <div className="response-toolbar"><div className="tab-strip" role="tablist">{(['pretty', 'raw', 'headers', 'preview'] as const).map(tab => <button key={tab} role="tab" aria-selected={responseTab === tab} onClick={() => setResponseTab(tab)} className={`tab ${responseTab === tab ? 'active' : ''}`}>{tab === 'pretty' ? 'Pretty' : tab === 'raw' ? 'Raw' : tab === 'preview' ? 'Preview' : 'Headers'}{tab === 'headers' && <span className="count-badge">{response.headers.length}</span>}</button>)}</div><div className="response-toolbar-right">{response.contentType && <span className="response-kind">{response.contentType.split(';')[0]}</span>}<button className="icon-button subtle" title="Copy response text" onClick={() => void navigator.clipboard.writeText(response.text).then(() => notify('Response copied'))}><Copy size={15} /></button></div></div>
            {responseTab === 'preview' ? (/text\/html|application\/xhtml\+xml/i.test(response.contentType) ? <iframe className="response-preview" title="Sandboxed response preview" sandbox="" referrerPolicy="no-referrer" srcDoc={'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; form-action \'none\'">' + response.text} /> : <div className="no-body">HTML preview is available for text/html responses only.</div>) : responseTab === 'headers' ? <div className="response-headers">{response.headers.map(header => <div className="header-line" key={header.id}><span>{header.key}</span><span>{header.value}</span></div>)}</div> : response.bodyBase64 ? <div className="binary-content"><FileJson size={30} /><strong>Binary response</strong><p>{formatBytes(response.size)} · {response.contentType || 'application/octet-stream'}</p><button className="button outlined" onClick={downloadBinary}><Download size={15} /> Download file</button></div> : <CodeMirror className="response-editor" value={responseTab === 'pretty' ? pretty : response.text} editable={false} readOnly={true} height="min(38vh, 340px)" theme={theme === 'dark' ? oneDark : 'light'} extensions={responseTab === 'pretty' ? [json()] : []} basicSetup={{ foldGutter: true, lineNumbers: true }} />}
          </> : <div className="response-placeholder"><span className="response-placeholder-icon"><Braces size={28} /></span><strong>Ready when you are</strong><p>Send a request to view the response here.<br />Status, headers, and body will appear in this panel.</p><span className="shortcut-hint"><span>Ctrl</span> + <span>Enter</span> to send</span></div>}
        </section>
        <footer className="footer"><span><span className="status-dot" /> Local-first workspace</span><div><button onClick={() => void backup()}><Download size={13} /> Export backup</button><button onClick={() => importRef.current?.click()}><Upload size={13} /> Import backup</button><button onClick={() => postmanRef.current?.click()}><Upload size={13} /> Import Postman</button>{selectedCollection && <button onClick={() => downloadJson(`${selectedCollection.name}.postman_collection.json`, exportPostmanCollection(selectedCollection, folders, requests))}><Download size={13} /> Export Postman</button>}<input type="file" ref={importRef} hidden accept="application/json,.json" onChange={e => void importBackup(e.target.files?.[0])} /><input type="file" ref={postmanRef} hidden accept="application/json,.json" onChange={e => void importPostman(e.target.files?.[0])} /></div></footer>
      </div>
    </main>
    {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="modal" role="dialog" aria-modal="true" aria-label={modal === 'curl' ? 'Import cURL' : modal === 'proxy' ? 'Proxy settings' : modal === 'runner' ? 'Collection runner' : modal === 'stream' ? 'WebSocket / SSE console' : 'Environments'}><div className="modal-header"><strong>{modal === 'curl' ? 'Import cURL' : modal === 'proxy' ? 'Cloud Proxy settings' : modal === 'runner' ? 'Collection runner' : modal === 'stream' ? 'WebSocket / SSE console' : 'Manage environments'}</strong><button className="icon-button" onClick={() => setModal(null)} title="Close"><X size={18} /></button></div>
      {modal === 'stream' && <StreamConsole initialUrl={draft.url} onClose={() => setModal(null)} />}
      {modal === 'runner' && <><p className="modal-note">Run every request in a collection sequentially, evaluate response assertions and download a JSON report. HTTP 4xx/5xx are responses, not transport failures.</p><div className="environment-controls"><select className="form-input" value={runCollectionId} onChange={e => setRunCollectionId(e.target.value)}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="button primary" onClick={() => void startRunner()}>{running ? 'Cancel run' : 'Run collection'}</button></div><div className="run-results">{runResults.map(r => <div className="run-line" key={r.requestId}><strong className="truncate">{r.name}</strong><span className={r.error || r.assertions.some(x => !x.passed) || (r.status && r.status >= 400) ? 'error-color' : 'success-color'}>{r.error || `${r.status} · ${r.duration}ms · ${r.assertions.filter(x => x.passed).length}/${r.assertions.length} tests`}</span></div>)}</div><div className="modal-footer"><button className="button outlined" disabled={!runResults.length} onClick={() => downloadJson('reqdock-test-report.json', { createdAt: new Date().toISOString(), results: runResults })}><Download size={14} /> Export report</button><button className="button outlined" onClick={() => setModal(null)}>Close</button></div></>}
      {modal === 'curl' && <><p className="modal-note">Paste a cURL command to populate URL, method, headers, and body. Unsupported options produce an error rather than being silently ignored.</p><textarea className="modal-textarea" placeholder={'curl -X POST https://api.example.com \\\n  -H "Content-Type: application/json" \\\n  -d \'{"hello":"world"}\''} value={curlText} onChange={e => setCurlText(e.target.value)} rows={8} /><div className="modal-footer"><button className="button outlined" onClick={() => setModal(null)}>Cancel</button><button className="button primary" onClick={onImportCurl}><Upload size={15} /> Import request</button></div></>}
      {modal === 'environment' && <><p className="modal-note">Variables can be used anywhere in a request as <code>{'{{variableName}}'}</code>. Values remain in this browser unless you export a backup.</p><div className="environment-controls"><select className="form-input" value={environmentId} onChange={e => setEnvironmentId(e.target.value)}><option value="">Select environment</option>{environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select><button className="button outlined" onClick={newEnvironment}><Plus size={14} /> New</button></div>{selectedEnv ? <><label className="field-label">Environment name</label><input className="form-input" value={selectedEnv.name} onChange={e => void saveEnvironment({ ...selectedEnv, name: e.target.value })} /><div className="environment-pairs"><PairEditor items={selectedEnv.variables} onChange={variables => void saveEnvironment({ ...selectedEnv, variables })} keyPlaceholder="Variable" valuePlaceholder="Value" /></div><button className="button danger outlined" onClick={() => void removeEnvironment()}><Trash2 size={14} /> Delete environment</button></> : <div className="modal-empty">Create or select an environment to edit its variables.</div>}<div className="modal-footer">{selectedEnv && <button className="button outlined" onClick={() => downloadJson(`${selectedEnv.name}.postman_environment.json`, exportPostmanEnvironment(selectedEnv))}><Download size={15} /> Export Postman</button>}<button className="button primary" onClick={() => setModal(null)}><Check size={15} /> Done</button></div></>}
      {modal === 'proxy' && <><div className="proxy-info"><ShieldAlert size={18} /><div><strong>Proxy is locked down by default</strong><p>Configure exact host allowlist and proxy key as Cloudflare Pages environment variables. The key entered here remains in memory and is not exported.</p></div></div><label className="field-label">Proxy key</label><input className="form-input" type="password" autoComplete="off" value={proxyKey} placeholder="REQDOCK_PROXY_KEY" onChange={e => setProxyKey(e.target.value)} /><p className="modal-note">Set <code>REQDOCK_ALLOWED_HOSTS</code> (comma-separated exact DNS names) and secret <code>REQDOCK_PROXY_KEY</code> under Pages → Settings → Variables and Secrets. Deploy with Git integration so Pages Functions is included. Direct mode requires neither.</p><div className="modal-footer"><button className="button primary" onClick={() => { setTransport('proxy'); setModal(null); }}><Check size={15} /> Use Cloud Proxy</button></div></>}
    </div></div>}
  </div>;
}
