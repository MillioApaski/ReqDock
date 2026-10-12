import { evaluateAssertions, type AssertionResult } from './assertions';
import { prepareRequest, sendRequest } from './request';
import type { Environment, RequestModel, Transport } from '../types';
export type RunResult = { requestId: string; name: string; status?: number; duration?: number; assertions: AssertionResult[]; error?: string };
export async function runCollection(requests: RequestModel[], environment: Environment | undefined, transport: Transport, proxyKey: string, signal: AbortSignal, onProgress?: (results: RunResult[]) => void): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const req of requests) {
    if (signal.aborted) break;
    try {
      const response = await sendRequest(prepareRequest(req, environment), transport, signal, proxyKey);
      results.push({ requestId: req.id, name: req.name, status: response.status, duration: response.duration, assertions: evaluateAssertions(req.assertions || [], response) });
    } catch (e) {
      if (signal.aborted) break;
      results.push({ requestId: req.id, name: req.name, assertions: [], error: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.([...results]);
  }
  return results;
}
