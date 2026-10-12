import { evaluateAssertions, type AssertionResult } from './assertions';
import { applyWorkflowScript } from './script';
import { prepareRequest, sendRequest } from './request';
import type { Environment, RequestModel, Transport } from '../types';
export type RunResult = { requestId: string; name: string; status?: number; duration?: number; assertions: AssertionResult[]; error?: string };
export async function runCollection(requests: RequestModel[], environment: Environment | undefined, transport: Transport, proxyKey: string, signal: AbortSignal, onProgress?: (results: RunResult[]) => void, onEnvironmentChange?: (env: Environment) => void): Promise<RunResult[]> {
  const results: RunResult[] = [];
  let workingEnv: Environment | undefined = environment ? { ...environment, variables: environment.variables.map(v => ({ ...v })) } : undefined;
  for (const req of requests) {
    if (signal.aborted) break;
    try {
      const before = applyWorkflowScript(req.preScript || '', workingEnv, 'before');
      workingEnv = before.environment;
      const response = await sendRequest(prepareRequest(req, workingEnv), transport, signal, proxyKey);
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
