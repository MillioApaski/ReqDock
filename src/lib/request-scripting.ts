import { blankPair, type Environment, type RequestModel, type SavedResponse } from '../types';
import type { AssertionResult } from './assertions';
import { applyWorkflowScript } from './script';
import type { SandboxInput, SandboxOutput } from './postman-vm';

export type ScriptResult={environment:Environment;checks:AssertionResult[]};

/** Existing DSL is the default. JS runs only when explicitly opted into. */
export async function executeRequestScript(request:RequestModel,environment:Environment|undefined,
  phase:'before'|'after',response?:SavedResponse,signal?:AbortSignal):Promise<ScriptResult> {
  const source=(phase==='before'?request.preScript:request.postScript)||'';
  if((request.scriptLanguage||'dsl')==='dsl'||!source.trim())
    return applyWorkflowScript(source,environment,phase,response);
  if(signal?.aborted) throw Error('Script cancelled.');
  const input:SandboxInput={source,environment,phase,response};
  const output=await new Promise<SandboxOutput>((resolve,reject)=>{
    const worker=new Worker(new URL('../workers/postman.worker.ts',import.meta.url),{type:'module'});
    let finished=false;
    const done=(error?:Error,result?:SandboxOutput)=>{
      if(finished) return;
      finished=true;clearTimeout(timeout);signal?.removeEventListener('abort',abort);
      worker.terminate();
      if(error) reject(error);
      else if(result) resolve(result);
      else reject(Error('Postman script returned no result.'));
    };
    const abort=()=>done(Error('Script cancelled.'));
    const timeout=setTimeout(()=>done(Error('Postman script exceeded 3-second wall-clock limit.')),3000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=(event:MessageEvent<{ok:boolean;value?:SandboxOutput;error?:string}>)=>{
      const result=event.data;
      if(result.ok&&result.value) done(undefined,result.value);
      else done(Error(result.error||'Postman script failed.'));
    };
    worker.onerror=()=>done(Error('Postman script worker failed.'));
    worker.postMessage(input);
  });
  const copy:Environment=environment?{...environment,variables:environment.variables.map(v=>({...v}))}
    :{id:'',name:'Run-scoped variables',variables:[]};
  if(output.operations.length>250||output.checks.length>100) throw Error('Postman script output exceeded limits.');
  for(const operation of output.operations) {
    if(!/^[\w.-]{1,100}$/.test(operation.key)) throw Error('Invalid script variable.');
    if(operation.op==='unset') copy.variables=copy.variables.filter(v=>v.key!==operation.key);
    else if(operation.op==='set'){
      if(typeof operation.value!=='string'||operation.value.length>8192) throw Error('Invalid script variable value.');
      const item=copy.variables.find(v=>v.key===operation.key);
      if(item){item.value=operation.value;item.enabled=true;}
      else copy.variables.push({...blankPair(),key:operation.key,value:operation.value});
    } else throw Error('Unsupported script operation.');
  }
  return {environment:copy,checks:output.checks};
}
