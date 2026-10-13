import { describe,expect,it } from 'vitest';
import { runPostmanVM } from '../src/lib/postman-vm';
import { parsePostmanCollection, exportPostmanCollection } from '../src/lib/postman';
import type { Environment, SavedResponse } from '../src/types';

const environment:Environment={id:'dev',name:'Dev',variables:[]};
const response:SavedResponse={status:200,statusText:'OK',duration:21,text:'{"access_token":"abc","items":[1,2]}',
  size:42,contentType:'application/json',
  headers:[{id:'h',key:'Content-Type',value:'application/json',enabled:true}]};

describe('isolated Postman JS sandbox',()=>{
  it('supports environment chaining without mutating the original environment',async()=>{
    const result=await runPostmanVM({source:[
      'pm.environment.set("token", "abc");',
      'pm.variables.set("requestId", 27);',
      'pm.environment.unset("old");',
    ].join('\n'),environment,phase:'before'});
    expect(result.operations).toEqual([
      {op:'set',key:'token',value:'abc'},
      {op:'set',key:'requestId',value:'27'},
      {op:'unset',key:'old'},
    ]);
    expect(environment.variables).toHaveLength(0);
  });
  it('collects named pm.test assertions and continues after failures',async()=>{
    const result=await runPostmanVM({source:[
      'const data = pm.response.json();',
      'pm.test("status 200", function(){ pm.expect(pm.response.code).to.eql(200); });',
      'pm.test("token exists", () => pm.expect(data).to.have.property("access_token"));',
      'pm.test("wrong status", () => pm.expect(pm.response.code).to.equal(201));',
      'pm.test("header present", () => pm.response.to.have.status(200));',
      'pm.test("after failure", () => pm.expect(data.items).to.have.lengthOf(2));',
      'pm.environment.set("token", data.access_token);'
    ].join('\n'),environment,phase:'after',response});
    expect(result.checks.map(x=>x.passed)).toEqual([true,true,false,true,true]);
    expect(result.operations).toContainEqual({op:'set',key:'token',value:'abc'});
    expect(result.checks[2].actual).toContain('201');
  });
  it('does not expose browser or network APIs inside QuickJS',async()=>{
    const result=await runPostmanVM({source:[
      'pm.test("no host APIs", function(){',
      '  pm.expect(typeof fetch).to.equal("undefined");',
      '  pm.expect(typeof document).to.equal("undefined");',
      '  pm.expect(typeof require).to.equal("undefined");',
      '});',
    ].join('\n'),phase:'after',response});
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].passed).toBe(true);
  });
  it('interrupts an infinite loop and refuses oversized scripts',async()=>{
    await expect(runPostmanVM({source:'while(true){}',phase:'before'})).rejects.toThrow();
    await expect(runPostmanVM({source:' '.repeat(17000),phase:'before'})).rejects.toThrow('16 KiB');
  });
});
describe('Postman scripts in Collection exchange',()=>{
  it('round-trips request-level prerequest and tests event source',()=>{
    const collection=parsePostmanCollection({
      info:{name:'Example',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},
      item:[{name:'Login',request:{method:'GET',url:'https://api.example.com/login'},event:[
        {listen:'prerequest',script:{exec:['pm.environment.set("nonce", 123);']}},
        {listen:'test',script:{exec:['pm.test("OK", () => pm.expect(pm.response.code).to.eql(200));']}},
      ]}],
    });
    expect(collection.requests[0]).toMatchObject({
      scriptLanguage:'postman',
      preScript:'pm.environment.set("nonce", 123);',
    });
    const exported=exportPostmanCollection(collection.collection,collection.folders,collection.requests);
    const events=((exported.item as Array<Record<string,unknown>>)[0].event as Array<Record<string,unknown>>);
    expect(events.map(e=>e.listen)).toEqual(['prerequest','test']);
    expect((events[1].script as Record<string,unknown>).exec).toBeInstanceOf(Array);
  });
});
