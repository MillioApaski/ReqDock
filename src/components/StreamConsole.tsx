import { useEffect, useRef, useState } from 'react';
import { Send, Square, Radio, Download } from 'lucide-react';
type EventEntry = { time: string; direction: 'in' | 'out' | 'info'; data: string };
export function StreamConsole({ initialUrl, onClose }: { initialUrl: string; onClose: () => void }) {
  const [protocol, setProtocol] = useState<'ws' | 'sse'>('sse');
  const [url, setUrl] = useState(initialUrl);
  const [message, setMessage] = useState('');
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const controller = useRef<AbortController | null>(null);
  const append = (direction: EventEntry['direction'], data: string) => setEvents(old => [...old.slice(-499), { time: new Date().toLocaleTimeString(), direction, data: data.slice(0, 32768) }]);
  const stop = () => { ws.current?.close(); ws.current = null; controller.current?.abort(); controller.current = null; setConnected(false); };
  useEffect(() => () => { ws.current?.close(); controller.current?.abort(); }, []);
  const connect = async () => {
    stop(); setEvents([]);
    try {
      const target = new URL(url);
      if (protocol === 'ws') {
        if (!['ws:', 'wss:'].includes(target.protocol)) throw new Error('WebSocket URL must start with ws:// or wss://');
        const socket = new WebSocket(target.toString()); ws.current = socket;
        socket.onopen = () => { setConnected(true); append('info', 'Connected'); };
        socket.onclose = e => { setConnected(false); append('info', `Disconnected (${e.code})`); };
        socket.onerror = () => append('info', 'Connection error');
        socket.onmessage = e => append('in', typeof e.data === 'string' ? e.data : '[binary message]');
      } else {
        if (!['https:', 'http:'].includes(target.protocol)) throw new Error('SSE URL must be HTTP(S)');
        const abort = new AbortController(); controller.current = abort;
        const res = await fetch(target.toString(), { headers: { Accept: 'text/event-stream' }, signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(`SSE request failed: ${res.status}`);
        setConnected(true); append('info', `Connected (${res.status})`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        try {
          while (!abort.signal.aborted) {
            const { done, value } = await reader.read(); if (done) break;
            buffer += value; if (buffer.length > 65536) { buffer = ''; append('info', 'Oversized SSE frame skipped'); }
            const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || '';
            for (const frame of frames) {
              const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (data) append('in', data);
            }
          }
        } finally { reader.releaseLock(); setConnected(false); append('info', 'Stream closed'); }
      }
    } catch (error) { append('info', error instanceof Error ? error.message : 'Connection failed'); setConnected(false); }
  };
  const send = () => { if (ws.current?.readyState === WebSocket.OPEN) { ws.current.send(message); append('out', message); setMessage(''); } };
  const download = () => {
    const file = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(file); const a = document.createElement('a'); a.href = objectUrl; a.download = 'reqdock-stream-log.json'; a.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  return <div className="stream-console">
    <p className="modal-note">Direct browser connections only. WebSocket cannot set custom request headers in browsers. SSE requires CORS support and a streaming endpoint.</p>
    <div className="stream-controls"><select className="form-input" value={protocol} onChange={e => { stop(); setProtocol(e.target.value as 'ws' | 'sse'); }}><option value="sse">Server-Sent Events</option><option value="ws">WebSocket</option></select><input className="form-input" aria-label="Stream URL" value={url} onChange={e => setUrl(e.target.value)} placeholder={protocol === 'ws' ? 'wss://example.com/ws' : 'https://example.com/events'} /><button className="button primary" onClick={() => { if (connected) stop(); else void connect(); }}>{connected ? <><Square size={14} /> Stop</> : <><Radio size={14} /> Connect</>}</button></div>
    <div className="stream-events">{events.map((entry, i) => <div className={`stream-entry stream-${entry.direction}`} key={i}><small>{entry.time} {entry.direction}</small><pre>{entry.data}</pre></div>)}{!events.length && <div className="modal-empty">No messages received yet.</div>}</div>
    {protocol === 'ws' && <div className="stream-send"><input className="form-input" aria-label="Message to send" placeholder="Message..." value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} /><button className="button outlined" disabled={!connected} onClick={send}><Send size={14} /> Send</button></div>}
    <div className="modal-footer"><button className="button outlined" disabled={!events.length} onClick={download}><Download size={14} /> Export log</button><button className="button outlined" onClick={() => { stop(); onClose(); }}>Close</button></div>
  </div>;
}
