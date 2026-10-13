import { evaluateAssertions, type AssertionResult } from './assertions';
import { applyWorkflowScript } from './script';
import { prepareRequest, sendRequest } from './request';
import type { CookieRecord, Environment, RequestModel, Transport } from '../types';
import { applySetCookies, cookieHeader } from './cookies';
export type RunResult = { requestId: string; name: string; status?: number; duration?: number; assertions: AssertionResult[]; error?: string };
export async function runCollection(requests: RequestModel[], environment: Environment | undefined, transport: Transport, proxyKey: string, signal: AbortSignal, onProgress?: (results: RunResult[]) => void, onEnvironmentChange?: (env: Environment) => void, cookieJar?: { cookies: CookieRecord[]; onChange: (cookies: CookieRecord[]) => Promise<void> }, agentToken = ''): Promise<RunResult[]> {
  const results: RunResult[] = [];
  let workingEnv: Environment | undefined = environment ? { ...environment, variables: environment.variables.map(v => ({ ...v })) } : undefined;
  let cookies = cookieJar?.cookies || [];
  for (const req of requests) {
    if (signal.aborted) break;
    try {
      const before = applyWorkflowScript(req.preScript || '', workingEnv, 'before');
      workingEnv = before.environment;
      const prepared = prepareRequest(req, workingEnv);
      if (transport === 'proxy' && cookieJar && !Object.keys(prepared.headers).some(key => key.toLowerCase() === 'cookie')) {
        const value = cookieHeader(cookies, prepared.url);
        if (value) prepared.headers.Cookie = value;
      }
      const response = await sendRequest(prepared, transport, signal, proxyKey, undefined, agentToken);
      if (transport === 'proxy' && cookieJar && response.setCookies?.length) {
        cookies = applySetCookies(cookies, prepared.url, response.setCookies);
        await cookieJar.onChange(cookies);
      }
      const after = applyWorkflowScript(req.postScript || '', workingEnv, 'after', response);
      workingEnv = after.environment;
      results.push({ requestId: req.id, name: req.name, status: response.status, duration: response.duration, assertions: [...evaluateAssertions(req.assertions || [], response), ...after.checks] });
    } catch (e) {
      if (signal.aborted) break;
      results.push({ requestId: req.id, name: req.name, assertions: [], error: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.([...results]);
  }
  if (environment && workingEnv && !signal.aborted) onEnvironmentChange?.(workingEnv);
  return results;
}
