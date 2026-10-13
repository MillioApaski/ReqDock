import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  Activity, ArrowDownToLine, Braces, Check, ChevronDown, Clock3, Cloud,
  Code2, Copy, Download, ExternalLink, FileJson, FolderOpen, Globe2, History,
  Layers2, Menu, Moon, Plus, Save, Search, Send, Settings2, FolderPlus, Folder as FolderIcon, Play,
  ShieldAlert, SlidersHorizontal, Sun, Terminal, Trash2, Upload, X, Zap, Cookie, Laptop, Network,
} from 'lucide-react';
import { PairEditor } from './components/PairEditor';
import { db, persistHistory } from './lib/storage';
import { downloadJson, readBackup } from './lib/export';
import { exportCurl, importCurl } from './lib/curl';
import { parsePostmanCollection, exportPostmanCollection, parsePostmanEnvironment, exportPostmanEnvironment } from './lib/postman';
import { parseApiDefinitionText } from './lib/openapi';
import { openTab, closeTab, restoreTabs } from './lib/tabs';
import { clampPaneRatio, DEFAULT_PANE_RATIO } from './lib/layout';
import { evaluateAssertions, newAssertion } from './lib/assertions';
import { runCollection, type RunResult } from './lib/runner';
import { authorizePkce } from './lib/oauth';
import { encryptBackup, decryptBackup, writeCloudSnapshot, readCloudSnapshot } from './lib/sync';
import { applyWorkflowScript } from './lib/script';
import { StreamConsole } from './components/StreamConsole';
import { GrpcConsole } from './components/GrpcConsole';
import { applySetCookies, cookieHeader, parseSetCookie } from './lib/cookies';
import { LOCAL_AGENT_URL, decodeBase64, formatJson, paramsFromUrl, prepareRequest, sendRequest, setUrlParams } from './lib/request';
import { blankPair, exampleRequest, newId, newRequest, type Environment, type HistoryItem, type HttpMethod, type KeyValue, type RequestModel, type SavedResponse, type Tab, type Transport, type Collection, type Folder, type Assertion, type CookieRecord, type GrpcRequestPreset } from './types';

type SidebarSection = 'collections' | 'history';
type Modal = 'curl' | 'environment' | 'proxy' | 'runner' | 'stream' | 'sync' | 'cookies' | 'agent' | 'grpc' | null;
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
  const [grpcPresets, setGrpcPresets] = useState<GrpcRequestPreset[]>([]);
  const [activeGrpcId, setActiveGrpcId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [runResults, setRunResults] = useState<RunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [runCollectionId, setRunCollectionId] = useState('');
  const runnerRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState<RequestModel>(() => newRequest());
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [params, setParams] = useState<KeyValue[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [section, setSection] = useState<SidebarSection>('collections');
  const [activeTab, setActiveTab] = useState<Tab>('params');
  const [responseTab, setResponseTab] = useState<'pretty' | 'raw' | 'headers' | 'preview'>('pretty');
  const [transport, setTransport] = useState<Transport>('direct');
  const [proxyKey, setProxyKey] = useState('');
  // Local Agent tokens remain in memory: never persist them to IndexedDB, localStorage or backups.
  const [agentToken, setAgentToken] = useState('');
  const [agentConnection, setAgentConnection] = useState<'idle' | 'checking' | 'online' | 'error'>('idle');
  const [agentMessage, setAgentMessage] = useState('');
  const [cookieJarEnabled, setCookieJarEnabled] = useState(() => { try { return localStorage.getItem('reqdock-proxy-cookie-jar') === 'true'; } catch { return false; } });
  const [cookies, setCookies] = useState<CookieRecord[]>([]);
  const [newCookieName, setNewCookieName] = useState('');
  const [newCookieValue, setNewCookieValue] = useState('');
  const [upload, setUpload] = useState<{ fieldName: string; file: File } | undefined>(undefined);
  const [authorizing, setAuthorizing] = useState(false);
  const [syncKey, setSyncKey] = useState('');
  const [syncPassphrase, setSyncPassphrase] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [response, setResponse] = useState<SavedResponse | null>(null);
  const [scriptResults, setScriptResults] = useState<ReturnType<typeof evaluateAssertions>>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [curlText, setCurlText] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('reqdock-theme') === 'light' ? 'light' : 'dark');
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paneRatio, setPaneRatio] = useState(() => {
    try { return clampPaneRatio(Number(localStorage.getItem('reqdock-pane-ratio')) || DEFAULT_PANE_RATIO); }
    catch { return DEFAULT_PANE_RATIO; }
  });
  const splitRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const postmanRef = useRef<HTMLInputElement>(null);
  const openapiRef = useRef<HTMLInputElement>(null);
  const tabSnapshots = useRef(new Map<string, { response: SavedResponse | null; error: string; scriptResults: ReturnType<typeof evaluateAssertions> }>());
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
        const [envs, previous, storedCookies, storedGrpcPresets] = await Promise.all([db.environments.toArray(), db.history.orderBy('at').reverse().limit(100).toArray(), db.cookies.toArray(), db.grpcRequests.toArray()]);
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
        let storedIds: unknown = [];
        try { storedIds = JSON.parse(sessionStorage.getItem('reqdock-tabs') || '[]'); } catch { /* session storage may be unavailable */ }
        const opened = restoreTabs(storedIds, saved.map(r => r.id), saved[0].id);
        const first = saved.find(r => r.id === opened[0]) || saved[0];
        setOpenTabIds(opened);
        setRequests(saved); setDraft(first); setParams(paramsFromUrl(first.url));
        setGrpcPresets(storedGrpcPresets); setCookies(storedCookies); setEnvironments(envs); setHistory(previous); setCollections(existingCollections); setFolders(savedFolders); setExpanded(existingCollections.map(c => c.id).concat(savedFolders.map(f => f.id))); setRunCollectionId(existingCollections[0].id); setReady(true);
      } catch { if (mounted) { setError('IndexedDB is unavailable. Requests will not be saved between visits.'); setReady(true); } }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => { if (modal !== 'sync') { setSyncKey(''); setSyncPassphrase(''); } }, [modal]);
  useEffect(() => { if (ready && openTabIds.length) try { sessionStorage.setItem('reqdock-tabs', JSON.stringify(openTabIds)); } catch { /* private browsing */ } }, [openTabIds, ready]);
  useEffect(() => { try { localStorage.setItem('reqdock-proxy-cookie-jar', String(cookieJarEnabled)); } catch { /* private browsing */ } }, [cookieJarEnabled]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('reqdock-theme', theme); }, [theme]);
  useEffect(() => { try { localStorage.setItem('reqdock-pane-ratio', String(paneRatio)); } catch { /* storage is optional */ } }, [paneRatio]);
  const resizePanels = (clientY: number) => {
    const region = splitRef.current?.getBoundingClientRect();
    if (!region || !region.height) return;
    setPaneRatio(clampPaneRatio((clientY - region.top) / region.height * 100));
  };
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
    const previous = latestRequestRef.current;
    if (previous.id === item.id) return;
    // Flush the in-flight editor buffer before switching. Debounced IndexedDB writes
    // alone would otherwise lose edits when rapidly alternating between tabs.
    tabSnapshots.current.set(previous.id, { response, error, scriptResults });
    if (ready) {
      void db.requests.put(previous).catch(() => setError('Could not save the previous request.'));
      setRequests(old => old.some(r => r.id === previous.id) ? old.map(r => r.id === previous.id ? previous : r) : [...old, previous]);
    }
    setOpenTabIds(old => openTab(old, item.id));
    const target = tabSnapshots.current.get(item.id);
    setUpload(undefined);
    setDraft(item); setParams(paramsFromUrl(item.url));
    setResponse(target?.response || null); setScriptResults(target?.scriptResults || []); setError(target?.error || '');
    setSidebarOpen(false);
  };
  const closeRequestTab = (id: string) => {
    const outcome = closeTab(openTabIds, id);
    if (outcome.tabs === openTabIds) return;
    if (draft.id === id && outcome.nextId) {
      const next = requests.find(r => r.id === outcome.nextId);
      if (next) selectRequest(next);
    }
    setOpenTabIds(outcome.tabs);
    tabSnapshots.current.delete(id);
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
  const saveGrpcPreset = async (preset: GrpcRequestPreset) => {
    await db.grpcRequests.put(preset);
    setGrpcPresets(old => [...old.filter(item => item.id !== preset.id), preset]);
  };
  const deleteGrpcPreset = async (id: string) => {
    await db.grpcRequests.delete(id);
    setGrpcPresets(old => old.filter(item => item.id !== id));
    setActiveGrpcId(null); setModal(null);
  };
  const deleteCollection = async (collection: Collection) => {
    if (collections.length <= 1) { notify('Keep at least one collection'); return; }
    const target = collections.find(c => c.id !== collection.id)!;
    if (!window.confirm(`Delete collection "${collection.name}"? Its requests will move into "${target.name}".`)) return;
    const moved = requests.filter(r => r.collectionId === collection.id).map(r => ({ ...r, collectionId: target.id, folderId: undefined, updatedAt: Date.now() }));
    const movedGrpc = grpcPresets.filter(item => item.collectionId === collection.id)
      .map(item => ({ ...item, collectionId: target.id, updatedAt: Date.now() }));
    await db.transaction('rw', db.collections, db.folders, db.requests, db.grpcRequests, async () => {
      if (movedGrpc.length) await db.grpcRequests.bulkPut(movedGrpc);
      if (moved.length) await db.requests.bulkPut(moved);
      await db.folders.where('collectionId').equals(collection.id).delete();
      await db.collections.delete(collection.id);
    });
    setRequests(old => old.map(r => r.collectionId === collection.id ? { ...r, collectionId: target.id, folderId: undefined } : r));
    if (movedGrpc.length) setGrpcPresets(old => old.map(item =>
      item.collectionId === collection.id ? { ...item, collectionId: target.id } : item));
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
    tabSnapshots.current.delete(item.id);
    const closing = closeTab(openTabIds, item.id);
    setOpenTabIds(closing.tabs.filter(id => id !== item.id));
    const remaining = requests.filter(r => r.id !== item.id);
    setRequests(remaining);
    if (draft.id === item.id) {
      const fallback = remaining.find(r => r.id === closing.nextId) || remaining[0] || newRequest();
      setOpenTabIds(old => openTab(old, fallback.id));
      setDraft(fallback); setParams(paramsFromUrl(fallback.url)); setResponse(null); setError('');
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

  const persistCookies = async (next: CookieRecord[]) => {
    await db.transaction('rw', db.cookies, async () => {
      await db.cookies.clear();
      if (next.length) await db.cookies.bulkPut(next);
    });
    setCookies(next);
  };
  const removeCookie = async (id: string) => { await db.cookies.delete(id); setCookies(old => old.filter(cookie => cookie.id !== id)); };
  const addManualCookie = async () => {
    try {
      const url = new URL(draft.url);
      const cookie = parseSetCookie(newCookieName + '=' + newCookieValue + '; Path=/', url.toString());
      if (!cookie) { notify('Invalid cookie name or value'); return; }
      await persistCookies(applySetCookies(cookies, url.toString(), [newCookieName + '=' + newCookieValue + '; Path=/']));
      setNewCookieName(''); setNewCookieValue(''); notify('Cookie saved locally');
    } catch { notify('Enter a valid absolute request URL before adding a cookie'); }
  };
  const testAgent = async () => {
    if (!agentToken) { setAgentConnection('error'); setAgentMessage('Enter the pairing token printed in the Local Agent terminal.'); return; }
    setAgentConnection('checking'); setAgentMessage('');
    try {
      const res = await fetch(LOCAL_AGENT_URL + '/status', {
        headers: { 'X-ReqDock-Agent-Token': agentToken },
        signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
      const data = await res.json() as { ok?: boolean; error?: string; allowedHosts?: string[] };
      if (!res.ok || !data.ok) throw Error(data.error || 'Agent health check failed.');
      setAgentConnection('online');
      setAgentMessage('Connected. Allowed targets: ' + (data.allowedHosts || []).join(', '));
    } catch (cause) {
      setAgentConnection('error');
      setAgentMessage(cause instanceof TypeError ? 'Local Agent unreachable. Start it on this computer and permit local network access in the browser.' : cause instanceof Error ? cause.message : 'Connection failed.');
    }
  };
  const execute = useCallback(async () => {
    if (sending) { abortRef.current?.abort(); return; }
    setError(''); setResponse(null); setResponseTab('pretty'); setScriptResults([]);
    const sentRequestId = draft.id;
    tabSnapshots.current.set(sentRequestId, { response: null, error: '', scriptResults: [] });
    let prepared;
    let workingEnv: Environment | undefined;
    try { workingEnv = applyWorkflowScript(draft.preScript || '', selectedEnv, 'before').environment; prepared = prepareRequest(draft, workingEnv); }
    catch (cause) { const message = cause instanceof Error ? cause.message : 'Invalid request.'; tabSnapshots.current.set(sentRequestId, { response: null, error: message, scriptResults: [] }); if (latestRequestRef.current.id === sentRequestId) setError(message); return; }
    if (transport === 'proxy' && cookieJarEnabled && !Object.keys(prepared.headers).some(key => key.toLowerCase() === 'cookie')) {
      const value = cookieHeader(cookies, prepared.url);
      if (value) prepared.headers.Cookie = value;
    }
    const controller = new AbortController(); abortRef.current = controller; setSending(true);
    try {
      const result = await sendRequest(prepared, transport, controller.signal, proxyKey, upload, agentToken);
      if (transport === 'proxy' && cookieJarEnabled && result.setCookies?.length) {
        try { await persistCookies(applySetCookies(cookies, prepared.url, result.setCookies)); }
        catch { notify('Cookie could not be saved locally'); }
      }
      const after = applyWorkflowScript(draft.postScript || '', workingEnv, 'after', result);
      tabSnapshots.current.set(sentRequestId, { response: result, error: '', scriptResults: after.checks });
      if (latestRequestRef.current.id === sentRequestId) { setResponse(result); setScriptResults(after.checks); }
      if (selectedEnv) await saveEnvironment(after.environment);
      const item: HistoryItem = { id: newId(), at: Date.now(), request: structuredClone(draft), status: result.status, duration: result.duration };
      void persistHistory(item).then(() => setHistory(old => [item, ...old].slice(0, 100)));
    } catch (cause) {
      const message = controller.signal.aborted ? 'Request cancelled.' : cause instanceof TypeError && transport === 'direct'
        ? 'Network request failed. This may be a CORS restriction. Try Cloud Proxy (requires configuration) or check the URL.'
        : cause instanceof Error ? cause.message : 'Request failed.';
      tabSnapshots.current.set(sentRequestId, { response: null, error: message, scriptResults: [] });
      if (latestRequestRef.current.id === sentRequestId) setError(message);
      const item: HistoryItem = { id: newId(), at: Date.now(), request: structuredClone(draft), error: message };
      void persistHistory(item).then(() => setHistory(old => [item, ...old].slice(0, 100)));
    } finally { abortRef.current = null; setSending(false); }
  }, [draft, selectedEnv, sending, transport, proxyKey, upload, cookies, cookieJarEnabled, agentToken]);
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
      const token = await authorizePkce(draft.auth, transport, proxyKey, agentToken);
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
  const backup = async () => downloadJson('reqdock-backup.json', { version: 3, exportedAt: new Date().toISOString(), requests: await db.requests.toArray(), environments: await db.environments.toArray(), collections: await db.collections.toArray(), folders: await db.folders.toArray(), grpcRequests: await db.grpcRequests.toArray() });
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
  const importOpenApi = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('API definition exceeds the 2 MiB import limit.');
      const imported = parseApiDefinitionText(await file.text());
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
      selectRequest(imported.requests[0]);
      notify(`Imported ${imported.requests.length} OpenAPI operations`);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'OpenAPI import failed'); }
    if (openapiRef.current) openapiRef.current.value = '';
  };
  const startRunner = async () => {
    if (running) { runnerRef.current?.abort(); return; }
    const queue = requests.filter(r => r.collectionId === runCollectionId);
    if (!queue.length) { notify('Collection has no requests'); return; }
    const abort = new AbortController(); runnerRef.current = abort;
    setRunning(true); setRunResults([]);
    try { await runCollection(queue, selectedEnv, transport, proxyKey, abort.signal, setRunResults, environment => { void saveEnvironment(environment); }, transport === 'proxy' && cookieJarEnabled ? { cookies, onChange: persistCookies } : undefined, agentToken); }
    finally { setRunning(false); runnerRef.current = null; }
  };
  const uploadCloud = async () => {
    if (syncBusy) return;
    if (!window.confirm('Replace the existing cloud snapshot with your current local workspace?')) return;
    setSyncBusy(true);
    try {
      const content = { version: 3, requests: await db.requests.toArray(), environments: await db.environments.toArray(), collections: await db.collections.toArray(), folders: await db.folders.toArray(), grpcRequests: await db.grpcRequests.toArray() };
      const encrypted = await encryptBackup(content, syncPassphrase);
      await writeCloudSnapshot(encrypted, syncKey);
      notify('Encrypted HTTP and gRPC workspace uploaded to Cloudflare D1');
    } catch (error) { notify(error instanceof Error ? error.message : 'Cloud upload failed'); }
    finally { setSyncBusy(false); }
  };
  const restoreCloud = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    try {
      const snapshot = await readCloudSnapshot(syncKey);
      const data = readBackup(await decryptBackup(snapshot.encrypted, syncPassphrase));
      if (!window.confirm(`Restore cloud snapshot from ${snapshot.updatedAt}? This REPLACES local HTTP requests, gRPC requests, collections and environments.`)) return;
      if (!data.collections.length) {
        const defaultCollection: Collection = { id: newId(), name: 'Restored collection', createdAt: Date.now() };
        data.collections = [defaultCollection];
        data.requests = data.requests.map(r => ({ ...r, collectionId: r.collectionId || defaultCollection.id }));
        data.grpcRequests = data.grpcRequests.map(g => ({...g, collectionId:defaultCollection.id}));
      }
      await db.transaction('rw', db.requests, db.environments, db.collections, db.folders, db.grpcRequests, async () => {
        await Promise.all([db.requests.clear(), db.environments.clear(), db.collections.clear(), db.folders.clear(), db.grpcRequests.clear()]);
        await db.collections.bulkPut(data.collections); await db.folders.bulkPut(data.folders);
        await db.requests.bulkPut(data.requests); await db.environments.bulkPut(data.environments);
        if (data.grpcRequests.length) await db.grpcRequests.bulkPut(data.grpcRequests);
      });
      const restored = data.requests[0] || { ...newRequest(), collectionId: data.collections[0].id };
      setRequests(data.requests); setCollections(data.collections); setFolders(data.folders); setEnvironments(data.environments);
      setGrpcPresets(data.grpcRequests); setActiveGrpcId(null);
      setExpanded([...data.collections.map(c => c.id), ...data.folders.map(f => f.id)]);
      setRunCollectionId(data.collections[0].id); setEnvironmentId('');
      tabSnapshots.current.clear(); setOpenTabIds([restored.id]);
      setDraft(restored); setParams(paramsFromUrl(restored.url)); setResponse(null); setError('');
      notify('Encrypted HTTP and gRPC workspace restored locally');
    } catch (error) { notify(error instanceof Error ? error.message : 'Cloud restore failed'); }
    finally { setSyncBusy(false); }
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const incoming = readBackup(JSON.parse(await file.text()));
      if (!incoming.collections.length) {
        const current = collections[0] || { id: newId(), name: 'Imported', createdAt: Date.now() };
        incoming.collections = [current];
        incoming.requests = incoming.requests.map(r => ({ ...r, collectionId: r.collectionId || current.id }));
        incoming.grpcRequests = incoming.grpcRequests.map(g => ({...g, collectionId:current.id}));
      }
      await db.transaction('rw', db.requests, db.environments, db.collections, db.folders, db.grpcRequests, async () => {
        await db.requests.bulkPut(incoming.requests); await db.environments.bulkPut(incoming.environments);
        await db.collections.bulkPut(incoming.collections); await db.folders.bulkPut(incoming.folders);
        if (incoming.grpcRequests.length) await db.grpcRequests.bulkPut(incoming.grpcRequests);
      });
      const saved = await db.requests.orderBy('updatedAt').reverse().toArray();
      setRequests(saved); setEnvironments(await db.environments.toArray()); setCollections(await db.collections.toArray()); setFolders(await db.folders.toArray());
      setGrpcPresets(await db.grpcRequests.toArray());
      if (saved.length) selectRequest(saved[0]);
      notify(`Imported ${incoming.requests.length} HTTP and ${incoming.grpcRequests.length} gRPC requests`);
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
  const renderGrpcPreset = (item: GrpcRequestPreset) => <div className="request-list-item" key={item.id}>
    <button className="request-item-main" onClick={() => { setActiveGrpcId(item.id); setModal('grpc'); setSidebarOpen(false); }}>
      <span className="request-method method-grpc">RPC</span><span className="truncate">{item.name}</span>
    </button>
    <button className="icon-button subtle delete-on-hover" title="Delete saved gRPC request"
      onClick={() => { if (window.confirm('Delete "' + item.name + '"?')) void deleteGrpcPreset(item.id); }}><Trash2 size={13}/></button>
  </div>;
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


  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
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
          {expanded.includes(col.id) && <div className="tree-children">{renderFolders(col.id)}{filtered.filter(r => r.collectionId === col.id && !r.folderId).map(renderRequest)}{grpcPresets.filter(g => g.collectionId === col.id &&
            `${g.name} ${g.target} ${g.service}`.toLowerCase().includes(search.toLowerCase())).map(renderGrpcPreset)}</div>}
        </div>)}{!filtered.length && !grpcPresets.some(g => `${g.name} ${g.target} ${g.service}`.toLowerCase().includes(search.toLowerCase())) && <div className="empty-sidebar">No matching requests</div>}</div>
      </> : <div className="request-list history-list">{history.map(item => <button className="history-item" key={item.id} onClick={() => selectRequest({ ...item.request, id: newId(), updatedAt: Date.now() })}>
        <div><span className={`request-method ${methodClasses[item.request.method]}`}>{item.request.method}</span><span className="truncate">{item.request.name}</span></div>
        <small>{new Date(item.at).toLocaleString()} <span className={item.error ? 'error-color' : 'success-color'}>{item.error ? 'Failed' : item.status}</span></small>
      </button>)}{!history.length && <div className="empty-sidebar">Requests you send will appear here</div>}</div>}
      <div className="sidebar-bottom"><div className="sidebar-bottom-title"><span className="status-dot" /> All data stays in your browser</div><p>ReqDock stores your requests and environments locally using IndexedDB.</p><a href="https://github.com/MillioApaski/ReqDock" target="_blank" rel="noreferrer"><Code2 size={14} /> View on GitHub <ExternalLink size={12} /></a></div>
    </aside>
    {sidebarOpen && <button className="backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <main className="main-panel">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button sidebar-toggle" aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} onClick={() => { setSidebarCollapsed(value => !value); setSidebarOpen(false); }}><Menu size={19} /></button><button className="icon-button mobile-only" aria-label="Toggle menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span className="breadcrumb">Workspace</span><span className="slash">/</span><span className="breadcrumb-current">{draft.name}</span></div>
        <div className="topbar-actions"><div className="environment-picker"><Globe2 size={15} /><select aria-label="Current environment" value={environmentId} onChange={e => setEnvironmentId(e.target.value)}><option value="">No environment</option>{environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select><ChevronDown size={13} /></div><button className="icon-button" aria-label="Cookie Jar" title="Cookie Jar (Cloud Proxy)" onClick={() => setModal('cookies')}><Cookie size={17} /></button><button className="icon-button" title="Encrypted cloud sync" onClick={() => setModal('sync')}><Cloud size={17} /></button><button className="icon-button" title="Edit environments" onClick={() => setModal('environment')}><SlidersHorizontal size={17} /></button><span className="topbar-divider" /><button className="icon-button" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button></div>
      </header>
      <div className="request-tabbar" role="tablist" aria-label="Open requests">
        {openTabIds.map(id => {
          const item = id === draft.id ? draft : requests.find(r => r.id === id);
          if (!item) return null;
          return <div key={id} className={`workspace-tab ${id === draft.id ? 'selected' : ''}`}>
            <button className="workspace-tab-label" type="button" role="tab" aria-selected={id === draft.id} title={item.url || item.name} onClick={() => selectRequest(item)}>
              <span className={`request-method ${methodClasses[item.method]}`}>{item.method}</span><span className="truncate">{item.name}</span>
            </button>
            {openTabIds.length > 1 && <button className="workspace-tab-close" type="button" aria-label={`Close tab ${item.name}`} title="Close tab (does not delete request)" onClick={() => closeRequestTab(id)}><X size={13} /></button>}
          </div>;
        })}
        <button className="workspace-tab-add" type="button" title="New request tab" aria-label="New request tab" onClick={() => addRequest()}><Plus size={16} /></button>
      </div>
      <div className="content">
        <div className="content-heading"><div><div className="eyebrow">API WORKSPACE <span className="eyebrow-dot">·</span> REQUEST BUILDER</div><div className="heading-line"><input aria-label="Request name" className="request-title" value={draft.name} onChange={e => updateDraft({ name: e.target.value })} /><span className="saved-pill"><Check size={12} /> Local</span></div><p>Compose, send, and inspect HTTP requests in one place.</p><div className="request-location"><select aria-label="Request collection" value={draft.collectionId || ''} onChange={e => moveRequest(e.target.value)}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="Request folder" value={draft.folderId || ''} onChange={e => moveRequest(draft.collectionId || '', e.target.value || undefined)}><option value="">Collection root</option>{folders.filter(f => f.collectionId === draft.collectionId).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div></div><div className="request-actions"><button className="icon-button" aria-label="gRPC Console" title="gRPC Unary Console (Local Agent)" onClick={() => { setActiveGrpcId(null); setModal('grpc'); }}><Network size={17} /></button><button className="button outlined" onClick={() => setModal('stream')}><Activity size={15} /> Live</button><button className="button outlined" onClick={() => { setModal('runner'); setRunCollectionId(draft.collectionId || collections[0]?.id || ''); }}><Play size={15} /> Run</button><button className="button outlined" onClick={() => { void db.requests.put(draft); notify('Saved locally'); }}><Save size={15} /> Save</button><div className="dropdown"><button className="button outlined" onClick={() => setModal('curl')}><Terminal size={15} /> Import cURL</button></div><button className="icon-button" title="Copy as cURL" onClick={copyCurl}><Copy size={17} /></button></div></div>
        <div className="workspace-split" ref={splitRef} style={{ '--request-pane': `${paneRatio}%` } as CSSProperties}>
        <section className="request-box" aria-label="Request editor">
          <div className="request-url-row"><div className="method-select-wrap"><select aria-label="HTTP method" className={methodClasses[draft.method]} value={draft.method} onChange={e => updateDraft({ method: e.target.value as HttpMethod })}>{METHODS.map(method => <option key={method}>{method}</option>)}</select><ChevronDown size={13} /></div><input className="url-input" aria-label="Request URL" spellCheck={false} placeholder="Enter request URL or {{baseUrl}}/api/..." value={draft.url} onChange={e => changeUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void execute(); }} /><button className={`send-button ${sending ? 'sending' : ''}`} onClick={() => void execute()}>{sending ? <><X size={16} /> Cancel</> : <><Send size={16} /> Send</>}</button></div>
          <div className="request-options"><div className="tab-strip" role="tablist">{(['params','headers','auth','body','tests'] as Tab[]).map(tab => <button role="tab" aria-selected={activeTab === tab} className={`tab ${activeTab === tab ? 'active' : ''}`} key={tab} onClick={() => setActiveTab(tab)}>{tab === 'auth' ? 'Authorization' : tab.charAt(0).toUpperCase() + tab.slice(1)}{tab === 'headers' && draft.headers.filter(h => h.enabled && h.key).length > 0 && <span className="count-badge">{draft.headers.filter(h => h.enabled && h.key).length}</span>}</button>)}</div><div className="transport-toggle" title="Direct uses browser fetch; Cloud Proxy runs at Cloudflare; Agent runs on this computer"><button className={transport === 'direct' ? 'active' : ''} onClick={() => setTransport('direct')}><Zap size={13} /> Direct</button><button className={transport === 'proxy' ? 'active' : ''} onClick={() => setTransport('proxy')}><Cloud size={13} /> Proxy</button><button className={transport === 'agent' ? 'active' : ''} onClick={() => { setTransport('agent'); if (!agentToken) setModal('agent'); }}><Laptop size={13} /> Agent</button><button className="proxy-settings" title={transport === 'agent' ? 'Local Agent settings' : 'Proxy settings'} aria-label={transport === 'agent' ? 'Local Agent settings' : 'Proxy settings'} onClick={() => setModal(transport === 'agent' ? 'agent' : 'proxy')}><Settings2 size={14} /></button></div></div>
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
        <div className="split-handle" role="separator" aria-orientation="horizontal" aria-label="Resize request and response panels" aria-valuemin={28} aria-valuemax={72} aria-valuenow={paneRatio} tabIndex={0}
          title="Drag to resize panels · Double-click to reset"
          onDoubleClick={() => setPaneRatio(DEFAULT_PANE_RATIO)}
          onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setPaneRatio(value => clampPaneRatio(value + (event.key === 'ArrowDown' ? 5 : -5))); } else if (event.key === 'Home') setPaneRatio(28); else if (event.key === 'End') setPaneRatio(72); }}
          onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); resizePanels(event.clientY); }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizePanels(event.clientY); }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
        <div className="response-region">
        <div className="response-heading"><div className="response-title"><Activity size={18} /><strong>Response</strong>{response && <span className={`response-status ${response.status < 400 ? 'status-good' : 'status-bad'}`}>{response.status} {response.statusText}</span>}</div><div className="response-meta">{response && <><span><Clock3 size={13} /> {response.duration} ms</span><span><ArrowDownToLine size={13} /> {formatBytes(response.size)}</span></>}</div></div>
        <section className="response-box" aria-label="Response viewer">
          {error ? <div className="response-error"><ShieldAlert size={21} /><div><strong>Request failed</strong><p>{error}</p>{transport === 'direct' && <button className="text-link" onClick={() => setModal('proxy')}>Configure Cloud Proxy <ExternalLink size={12} /></button>}</div></div> : response ? <>
            <div className="response-toolbar"><div className="tab-strip" role="tablist">{(['pretty', 'raw', 'headers', 'preview'] as const).map(tab => <button key={tab} role="tab" aria-selected={responseTab === tab} onClick={() => setResponseTab(tab)} className={`tab ${responseTab === tab ? 'active' : ''}`}>{tab === 'pretty' ? 'Pretty' : tab === 'raw' ? 'Raw' : tab === 'preview' ? 'Preview' : 'Headers'}{tab === 'headers' && <span className="count-badge">{response.headers.length}</span>}</button>)}</div><div className="response-toolbar-right">{response.contentType && <span className="response-kind">{response.contentType.split(';')[0]}</span>}<button className="icon-button subtle" title="Copy response text" onClick={() => void navigator.clipboard.writeText(response.text).then(() => notify('Response copied'))}><Copy size={15} /></button></div></div>
            {responseTab === 'preview' ? (/text\/html|application\/xhtml\+xml/i.test(response.contentType) ? <iframe className="response-preview" title="Sandboxed response preview" sandbox="" referrerPolicy="no-referrer" srcDoc={'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; form-action \'none\'">' + response.text} /> : <div className="no-body">HTML preview is available for text/html responses only.</div>) : responseTab === 'headers' ? <div className="response-headers">{response.headers.map(header => <div className="header-line" key={header.id}><span>{header.key}</span><span>{header.value}</span></div>)}</div> : response.bodyBase64 ? <div className="binary-content"><FileJson size={30} /><strong>Binary response</strong><p>{formatBytes(response.size)} · {response.contentType || 'application/octet-stream'}</p><button className="button outlined" onClick={downloadBinary}><Download size={15} /> Download file</button></div> : <CodeMirror className="response-editor" value={responseTab === 'pretty' ? pretty : response.text} editable={false} readOnly={true} height="100%" theme={theme === 'dark' ? oneDark : 'light'} extensions={responseTab === 'pretty' ? [json()] : []} basicSetup={{ foldGutter: true, lineNumbers: true }} />}
          </> : <div className="response-placeholder"><span className="response-placeholder-icon"><Braces size={22} /></span><strong>No response yet</strong><p>Send an HTTP request to inspect its status, headers, and body.</p><span className="shortcut-hint"><span>Ctrl</span> + <span>Enter</span> to send</span></div>}
        </section>
        </div>
        </div>
        <footer className="footer"><span><span className="status-dot" /> Local-first workspace</span><details className="data-menu"><summary><FolderOpen size={14} /> Import / Export <ChevronDown size={13} /></summary><div className="data-menu-popup"><button onClick={() => void backup()}><Download size={13} /> Export backup</button><button onClick={() => importRef.current?.click()}><Upload size={13} /> Import backup</button><button onClick={() => postmanRef.current?.click()}><Upload size={13} /> Import Postman</button><button onClick={() => openapiRef.current?.click()}><Upload size={13} /> Import OpenAPI</button>{selectedCollection && <button onClick={() => downloadJson(`${selectedCollection.name}.postman_collection.json`, exportPostmanCollection(selectedCollection, folders, requests))}><Download size={13} /> Export Postman</button>}<input type="file" ref={importRef} hidden accept="application/json,.json" onChange={e => void importBackup(e.target.files?.[0])} /><input type="file" ref={postmanRef} hidden accept="application/json,.json" onChange={e => void importPostman(e.target.files?.[0])} /><input type="file" ref={openapiRef} hidden accept="application/json,.json,.yaml,.yml,application/yaml,text/yaml" onChange={e => void importOpenApi(e.target.files?.[0])} /></div></details></footer>
      </div>
    </main>
    {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><div className={`modal ${modal === 'grpc' ? 'grpc-modal' : ''}`} role="dialog" aria-modal="true" aria-label={modal === 'curl' ? 'Import cURL' : modal === 'proxy' ? 'Proxy settings' : modal === 'runner' ? 'Collection runner' : modal === 'stream' ? 'WebSocket / SSE console' : modal === 'sync' ? 'Encrypted cloud backup' : modal === 'cookies' ? 'Cookie Jar' : modal === 'agent' ? 'Local Agent' : modal === 'grpc' ? 'gRPC Console' : 'Environments'}><div className="modal-header"><strong>{modal === 'curl' ? 'Import cURL' : modal === 'proxy' ? 'Cloud Proxy settings' : modal === 'runner' ? 'Collection runner' : modal === 'stream' ? 'WebSocket / SSE console' : modal === 'sync' ? 'Encrypted cloud backup' : modal === 'cookies' ? 'Cookie Jar' : modal === 'agent' ? 'Local Agent' : modal === 'grpc' ? 'gRPC Console' : 'Manage environments'}</strong><button className="icon-button" onClick={() => setModal(null)} title="Close"><X size={18} /></button></div>
      {modal === 'cookies' && <>
         <div className="proxy-info"><ShieldAlert size={18} /><div><strong>Cloud Proxy cookie jar</strong><p>Opt-in only. Matching cookies are automatically sent to the exact host in Proxy mode. Values remain unencrypted in your browser's IndexedDB, even if marked HttpOnly. Not browser-enforced HttpOnly protection. Avoid on shared computers. Direct mode follows browser cookie rules and cannot inspect Set-Cookie.</p></div></div>
         <label className="cookie-toggle"><input type="checkbox" checked={cookieJarEnabled} onChange={event => setCookieJarEnabled(event.target.checked)} /> Enable Cloud Proxy cookie capture and sending</label>
         <div className="cookie-editor"><strong>Add for current request host</strong><div className="cookie-add-row"><input className="form-input" aria-label="Cookie name" placeholder="Name" value={newCookieName} onChange={event => setNewCookieName(event.target.value)} /><input className="form-input" aria-label="Cookie value" type="password" placeholder="Value" value={newCookieValue} onChange={event => setNewCookieValue(event.target.value)} /><button className="button outlined" onClick={() => void addManualCookie()}>Add</button></div><p className="modal-note">Manual cookies are host-only with Path=/. Use an absolute HTTP(S) request URL. Values are excluded from workspace backups.</p></div>
         <div className="cookie-list" aria-label="Saved cookies">{cookies.map(cookie => <div className="cookie-entry" key={cookie.id}><div><strong>{cookie.name}</strong><small>{cookie.domain}{cookie.path} · {cookie.secure ? 'Secure' : 'HTTP/HTTPS'}{cookie.httpOnly ? ' · HttpOnly attribute' : ''}{cookie.expiresAt ? ' · Expires ' + new Date(cookie.expiresAt).toLocaleString() : ' · Session'}</small></div><input aria-label={'Stored value of ' + cookie.name} type="password" readOnly value={cookie.value} /><button className="icon-button" aria-label={'Delete cookie ' + cookie.name} onClick={() => void removeCookie(cookie.id)}><Trash2 size={15} /></button></div>)}{!cookies.length && <div className="modal-empty">No cookies saved. Send a request in Proxy mode with the jar enabled, or add a cookie manually.</div>}</div>
         <div className="modal-footer"><button className="button outlined danger" disabled={!cookies.length} onClick={() => { if (window.confirm('Clear all saved cookies from this browser?')) void persistCookies([]); }}><Trash2 size={14} /> Clear all</button><button className="button primary" onClick={() => setModal(null)}><Check size={14} /> Done</button></div>
       </>}
       {modal === 'sync' && <><div className="proxy-info"><ShieldAlert size={18} /><div><strong>Encrypted, opt-in workspace backup</strong><p>AES-256-GCM encryption takes place in your browser. Cloudflare D1 stores only ciphertext. You must configure the D1 binding and a separate sync authentication key; neither secret nor passphrase is saved.</p></div></div><label className="field-label">Server sync key</label><input className="form-input" type="password" autoComplete="off" value={syncKey} onChange={e => setSyncKey(e.target.value)} placeholder="REQDOCK_SYNC_KEY" /><label className="field-label">Encryption passphrase (12+ characters)</label><input className="form-input" type="password" autoComplete="off" value={syncPassphrase} onChange={e => setSyncPassphrase(e.target.value)} placeholder="Your private encryption passphrase" /><p className="modal-note">Uploading overwrites the single remote snapshot. Restoring replaces local requests and settings after confirmation. Forgotten encryption passphrases cannot be recovered. D1 binding: <code>REQDOCK_DB</code>.</p><div className="modal-footer"><button className="button outlined" disabled={syncBusy || !syncKey || syncPassphrase.length < 12} onClick={() => void restoreCloud()}><Download size={14} /> Restore cloud</button><button className="button primary" disabled={syncBusy || !syncKey || syncPassphrase.length < 12} onClick={() => void uploadCloud()}><Upload size={14} /> Upload encrypted snapshot</button></div></>}
      {modal === 'stream' && <StreamConsole initialUrl={draft.url} onClose={() => setModal(null)} />}
       {modal === 'grpc' && <GrpcConsole key={activeGrpcId || 'new'} agentToken={agentToken}
         onPair={() => setModal('agent')} collections={collections} defaultCollectionId={draft.collectionId}
         preset={grpcPresets.find(item => item.id === activeGrpcId)}
         onSave={saveGrpcPreset} onDelete={deleteGrpcPreset} />}
      {modal === 'runner' && <><p className="modal-note">Run every request in a collection sequentially, evaluate response assertions and download a JSON report. HTTP 4xx/5xx are responses, not transport failures.</p><div className="environment-controls"><select className="form-input" value={runCollectionId} onChange={e => setRunCollectionId(e.target.value)}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="button primary" onClick={() => void startRunner()}>{running ? 'Cancel run' : 'Run collection'}</button></div><div className="run-results">{runResults.map(r => <div className="run-line" key={r.requestId}><strong className="truncate">{r.name}</strong><span className={r.error || r.assertions.some(x => !x.passed) || (r.status && r.status >= 400) ? 'error-color' : 'success-color'}>{r.error || `${r.status} · ${r.duration}ms · ${r.assertions.filter(x => x.passed).length}/${r.assertions.length} tests`}</span></div>)}</div><div className="modal-footer"><button className="button outlined" disabled={!runResults.length} onClick={() => downloadJson('reqdock-test-report.json', { createdAt: new Date().toISOString(), results: runResults })}><Download size={14} /> Export report</button><button className="button outlined" onClick={() => setModal(null)}>Close</button></div></>}
      {modal === 'curl' && <><p className="modal-note">Paste a cURL command to populate URL, method, headers, and body. Unsupported options produce an error rather than being silently ignored.</p><textarea className="modal-textarea" placeholder={'curl -X POST https://api.example.com \\\n  -H "Content-Type: application/json" \\\n  -d \'{"hello":"world"}\''} value={curlText} onChange={e => setCurlText(e.target.value)} rows={8} /><div className="modal-footer"><button className="button outlined" onClick={() => setModal(null)}>Cancel</button><button className="button primary" onClick={onImportCurl}><Upload size={15} /> Import request</button></div></>}
      {modal === 'environment' && <><p className="modal-note">Variables can be used anywhere in a request as <code>{'{{variableName}}'}</code>. Values remain in this browser unless you export a backup.</p><div className="environment-controls"><select className="form-input" value={environmentId} onChange={e => setEnvironmentId(e.target.value)}><option value="">Select environment</option>{environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select><button className="button outlined" onClick={newEnvironment}><Plus size={14} /> New</button></div>{selectedEnv ? <><label className="field-label">Environment name</label><input className="form-input" value={selectedEnv.name} onChange={e => void saveEnvironment({ ...selectedEnv, name: e.target.value })} /><div className="environment-pairs"><PairEditor items={selectedEnv.variables} onChange={variables => void saveEnvironment({ ...selectedEnv, variables })} keyPlaceholder="Variable" valuePlaceholder="Value" /></div><button className="button danger outlined" onClick={() => void removeEnvironment()}><Trash2 size={14} /> Delete environment</button></> : <div className="modal-empty">Create or select an environment to edit its variables.</div>}<div className="modal-footer">{selectedEnv && <button className="button outlined" onClick={() => downloadJson(`${selectedEnv.name}.postman_environment.json`, exportPostmanEnvironment(selectedEnv))}><Download size={15} /> Export Postman</button>}<button className="button primary" onClick={() => setModal(null)}><Check size={15} /> Done</button></div></>}
      {modal === 'agent' && <>
         <div className="proxy-info"><ShieldAlert size={18} /><div><strong>Run the connector on your own computer</strong><p>ReqDock cannot directly reach private networks from Cloudflare. The Local Agent listens on 127.0.0.1:47831 only, requires a new random pairing token on every start, and refuses destinations not in its explicit host allowlist. Never expose the agent port or pairing token publicly.</p></div></div>
         <p className="modal-note">In a terminal, install Node.js 22+, clone the ReqDock repository, run <code>npm install</code> and start:</p>
         <code className="agent-command">npm run agent -- --allow-hosts=192.168.1.100</code>
         <p className="modal-note">Replace the example IP with your API host, or omit <code>--allow-hosts</code> to access localhost only. Copy the token printed in the terminal. Refreshing ReqDock intentionally clears it.</p>
         <label className="field-label" htmlFor="agent-token">Agent pairing token</label>
         <input id="agent-token" className="form-input" type="password" autoComplete="off" value={agentToken} placeholder="Paste the token printed by Local Agent" onChange={event => { setAgentToken(event.target.value); setAgentConnection('idle'); setAgentMessage(''); }} />
         <p className="modal-note">Agent endpoint: <code>http://127.0.0.1:47831</code>. Browsers may request permission for access to your local network. The token stays only in this tab's memory.</p>
         {agentMessage && <div role="status" className={agentConnection === 'online' ? 'agent-status agent-ok' : 'agent-status agent-error'}>{agentMessage}</div>}
         <div className="modal-footer"><button className="button outlined" disabled={!agentToken || agentConnection === 'checking'} onClick={() => void testAgent()}><Laptop size={14} /> {agentConnection === 'checking' ? 'Connecting...' : 'Test connection'}</button><button className="button primary" disabled={agentConnection !== 'online'} onClick={() => { setTransport('agent'); setModal(null); }}><Check size={14} /> Use Local Agent</button></div>
       </>}
       {modal === 'proxy' && <><div className="proxy-info"><ShieldAlert size={18} /><div><strong>Proxy is locked down by default</strong><p>Configure exact host allowlist and proxy key as Cloudflare Pages environment variables. The key entered here remains in memory and is not exported.</p></div></div><label className="field-label">Proxy key</label><input className="form-input" type="password" autoComplete="off" value={proxyKey} placeholder="REQDOCK_PROXY_KEY" onChange={e => setProxyKey(e.target.value)} /><p className="modal-note">Set <code>REQDOCK_ALLOWED_HOSTS</code> (comma-separated exact DNS names) and secret <code>REQDOCK_PROXY_KEY</code> under Pages → Settings → Variables and Secrets. Deploy with Git integration so Pages Functions is included. Direct mode requires neither.</p><div className="modal-footer"><button className="button primary" onClick={() => { setTransport('proxy'); setModal(null); }}><Check size={15} /> Use Cloud Proxy</button></div></>}
    </div></div>}
  </div>;
}
