import { getQuickJS } from 'quickjs-emscripten';
import type { Environment, SavedResponse } from '../types';
import type { AssertionResult } from './assertions';
import { installPostman } from './postman-shim';

export type SandboxInput = {
  source:string; environment?:Environment; phase:'before'|'after'; response?:SavedResponse;
};
export type SandboxOutput = {
  operations:{op:'set'|'unset';key:string;value?:string}[];
  checks:AssertionResult[];
};

/**
 * Each call gets a fresh standalone QuickJS context: no DOM, fetch, timers,
 * Node APIs, module loader or host callbacks. Strict CPU/heap/stack budgets.
 * The browser additionally places the entire runtime in a disposable Worker.
 */
export async function runPostmanVM(input:SandboxInput):Promise<SandboxOutput> {
  if (new TextEncoder().encode(input.source).byteLength > 16*1024)
    throw Error('Postman script exceeds 16 KiB.');
  const module=await getQuickJS();
  const runtime=module.newRuntime();
  runtime.setMemoryLimit(64*1024*1024);
  runtime.setMaxStackSize(512*1024);
  const started=Date.now();
  runtime.setInterruptHandler(() => Date.now()-started>500);
  const vm=runtime.newContext();
  const evaluate=(source:string):unknown=>{
    const result=vm.evalCode(source);
    if(result.error) {
      const error=vm.dump(result.error) as unknown;
      result.error.dispose();
      const message=error && typeof error === 'object' && 'message' in error
        ? String(error.message) : String(error);
      throw Error(message);
    }
    const value=vm.dump(result.value);
    result.value.dispose();
    return value;
  };
  try {
    const payload={
      phase:input.phase,
      variables:(input.environment?.variables||[]).filter(v=>v.enabled&&v.key).map(v=>[v.key,v.value]),
      response:input.response?{
        code:input.response.status,status:input.response.statusText,responseTime:input.response.duration,
        text:input.response.text,headers:input.response.headers.map(h=>[h.key,h.value]),
      }:null,
    };
    evaluate('('+installPostman.toString()+')('+JSON.stringify(payload)+');');
    evaluate(input.source);
    const raw=evaluate('__reqdockFinish()');
    if(typeof raw!=='string') throw Error('Invalid Postman script result.');
    const output:unknown=JSON.parse(raw);
    if(!output||typeof output!=='object'||!('checks' in output)||!('operations' in output)||
      !Array.isArray(output.checks)||!Array.isArray(output.operations)) throw Error('Invalid Postman script result.');
    return output as SandboxOutput;
  } finally {vm.dispose();runtime.dispose();}
}
