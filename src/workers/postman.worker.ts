import { runPostmanVM, type SandboxInput } from '../lib/postman-vm';
self.onmessage=async(event:MessageEvent<SandboxInput>)=>{
  try {self.postMessage({ok:true,value:await runPostmanVM(event.data)});}
  catch(cause){self.postMessage({ok:false,error:cause instanceof Error?cause.message:String(cause)});}
};
