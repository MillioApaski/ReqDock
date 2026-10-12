import { newRequest, type HttpMethod, type RequestModel } from '../types';

/** Parse a typical POSIX-style curl command without shell evaluation. */
export function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let token = '', quote: "'" | '"' | null = null, started = false;
  const cmd = command.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) { quote = null; }
      else if (ch === '\\' && quote === '"' && i + 1 < cmd.length && ['"', '\\', '$', '`'].includes(cmd[i + 1])) token += cmd[++i];
      else token += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (ch === '\\' && i + 1 < cmd.length) { token += cmd[++i]; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started) { tokens.push(token); token = ''; started = false; }
    } else { token += ch; started = true; }
  }
  if (quote) throw new Error('Unclosed quotation mark in cURL command.');
  if (started) tokens.push(token);
  return tokens;
}
export function importCurl(input: string): RequestModel {
  const args = tokenizeShell(input.trim());
  if (!args.length || args[0].toLowerCase() !== 'curl') throw new Error('Paste a command starting with curl.');
  const item = newRequest();
  item.name = 'Imported cURL'; item.bodyType = 'none'; item.body = ''; item.headers = [];
  let method: HttpMethod | undefined, data: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (['-X', '--request'].includes(arg)) { method = (args[++i] || 'GET').toUpperCase() as HttpMethod; continue; }
    if (['-H', '--header'].includes(arg)) {
      const raw = args[++i] || ''; const index = raw.indexOf(':');
      if (index > 0) item.headers.push({ id: crypto.randomUUID(), key: raw.slice(0, index).trim(), value: raw.slice(index + 1).trim(), enabled: true });
      continue;
    }
    if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(arg)) { data = args[++i] || ''; continue; }
    if (arg === '--url') { item.url = args[++i] || ''; continue; }
    if (arg === '-I' || arg === '--head') { method = 'HEAD'; continue; }
    if (['-L', '--location', '-s', '--silent', '-i', '--include', '--compressed', '-k', '--insecure'].includes(arg)) continue;
    if (arg.startsWith('http://') || arg.startsWith('https://')) { item.url = arg; continue; }
    if (arg.startsWith('-')) throw new Error(`Unsupported cURL option: ${arg}. Remove it and try again.`);
  }
  if (!item.url) throw new Error('No URL was found in the cURL command.');
  item.method = method || (data !== undefined ? 'POST' : 'GET');
  if (data !== undefined) {
    item.body = data;
    const contentType = item.headers.find(h => h.key.toLowerCase() === 'content-type')?.value || '';
    item.bodyType = contentType.includes('x-www-form-urlencoded') ? 'urlencoded' : /json|^[\s]*[\[{]/.test(contentType || data) ? 'json' : 'text';
  }
  return item;
}
function shellQuote(input: string): string { return `'${input.replace(/'/g, "'\\''")}'`; }
export function exportCurl(request: RequestModel): string {
  const parts = ['curl', '-X', request.method, shellQuote(request.url)];
  for (const row of request.headers.filter(h => h.enabled && h.key)) parts.push('-H', shellQuote(`${row.key}: ${row.value}`));
  if (!['GET', 'HEAD'].includes(request.method) && request.bodyType !== 'none') parts.push('--data-raw', shellQuote(request.body));
  return parts.join(' \\\n  ');
}
