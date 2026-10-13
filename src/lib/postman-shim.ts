/**
 * Executed inside a fresh QuickJS context, never in the browser JS realm.
 * Keep this function self-contained: its source is serialized with toString().
 */
export function installPostman(input: {
  phase: 'before' | 'after';
  variables: [string, string][];
  response: {code:number;status:string;responseTime:number;text:string;headers:[string,string][]} | null;
}) {
  const vars: Record<string,string> = Object.create(null);
  const operations: {op:'set'|'unset';key:string;value?:string}[] = [];
  const checks: {id:string;label:string;actual:string;passed:boolean}[] = [];
  let testCount = 0;
  for (const pair of input.variables) vars[pair[0]] = pair[1];
  const scope = Object.freeze({
    get(name: string) {return Object.hasOwn(vars,String(name)) ? vars[String(name)] : undefined;},
    has(name: string) {return Object.hasOwn(vars,String(name));},
    set(name: string,value:unknown) {
      if (typeof name !== 'string' || !/^[\w.-]{1,100}$/.test(name)) throw Error('Invalid environment variable name.');
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (typeof text !== 'string' || text.length > 8192) throw Error('Variable must be serializable and at most 8192 characters.');
      vars[name] = text; operations.push({op:'set',key:name,value:text});
    },
    unset(name:string) {
      if (typeof name !== 'string' || !/^[\w.-]{1,100}$/.test(name)) throw Error('Invalid environment variable name.');
      delete vars[name];operations.push({op:'unset',key:name});
    },
  });
  const response = input.response;
  const getHeader = (name:string) => {
    if (!response) throw Error('Response is unavailable in pre-request scripts.');
    const pair = response.headers.find(item => item[0].toLowerCase() === String(name).toLowerCase());
    return pair?.[1];
  };
  const assertion = (value:unknown,neg=false,deep=false):unknown => {
    let chain:unknown;
    const check = (condition:boolean,label:string) => {
      if (neg ? condition : !condition) throw Error('Expected value ' + (neg ? 'not ' : '') + label);
      return chain;
    };
    const members = {
      equal:(expected:unknown) => check(deep ? JSON.stringify(value) === JSON.stringify(expected) : value === expected,'to equal ' + String(expected)),
      eql:(expected:unknown) => check(JSON.stringify(value) === JSON.stringify(expected),'to eql ' + String(expected)),
      above:(expected:number) => check(typeof value === 'number' && value > expected,'above ' + expected),
      below:(expected:number) => check(typeof value === 'number' && value < expected,'below ' + expected),
      oneOf:(values:unknown[]) => check(Array.isArray(values) && values.some(item => JSON.stringify(item) === JSON.stringify(value)),'oneOf'),
      include:(expected:unknown) => check(typeof value === 'string' ? value.includes(String(expected))
        : Array.isArray(value) ? value.some(item => JSON.stringify(item) === JSON.stringify(expected))
        : !!value && typeof value === 'object' && !!expected && typeof expected === 'object'
          ? Object.keys(expected).every(key => Object.hasOwn(value,key) &&
            JSON.stringify((value as Record<string,unknown>)[key]) === JSON.stringify((expected as Record<string,unknown>)[key]))
          : false,'to include ' + String(expected)),
      property:(name:string) => check(!!value && typeof value === 'object' && Object.hasOwn(value,name),'to have property ' + name),
      lengthOf:(count:number) => check(value != null && 'length' in Object(value) &&
        (value as {length:number}).length === count,'to have length ' + count),
      a:(kind:string) => check(kind === 'array' ? Array.isArray(value) : kind === 'null' ? value === null : typeof value === kind,'to be a ' + kind),
    };
    chain = new Proxy(members,{get(target,key) {
      if (typeof key !== 'string') return undefined;
      if (['to','be','been','that','which','is','have','has','and'].includes(key)) return chain;
      if (key === 'not') return assertion(value,!neg,deep);
      if (key === 'deep') return assertion(value,neg,true);
      if (key === 'an') return target.a;
      if (key === 'equals') return target.equal;
      if (key === 'true') return check(value === true,'to be true');
      if (key === 'false') return check(value === false,'to be false');
      if (key === 'ok') return check(Boolean(value),'to be truthy');
      if (key === 'null') return check(value === null,'to be null');
      if (key === 'undefined') return check(value === undefined,'to be undefined');
      if (key === 'empty') return check(value != null && ('length' in Object(value)
        ? (value as {length:number}).length === 0 : Object.keys(value).length === 0),'to be empty');
      if (Object.hasOwn(target,key)) return target[key as keyof typeof target];
      throw Error('Unsupported pm.expect assertion: ' + key);
    }});
    return chain;
  };
  const pmResponse = response ? Object.freeze({
    code:response.code,status:response.status,responseTime:response.responseTime,
    json:() => JSON.parse(response.text),text:() => response.text,
    headers:Object.freeze({get:getHeader,has:(name:string) => getHeader(name) !== undefined}),
    to:Object.freeze({have:Object.freeze({
      status:(code:number|string) => {
        if (response.code !== code && response.status !== code) throw Error('Expected status ' + code);
      },
      header:(name:string) => {if (getHeader(name) === undefined) throw Error('Missing response header ' + name);}
    })})
  }) : undefined;
  const pm = Object.freeze({
    environment:scope,variables:scope,collectionVariables:scope,response:pmResponse,
    expect:(value:unknown) => assertion(value),
    test:(name:string,fn:()=>unknown) => {
      if (typeof name !== 'string' || name.length > 200 || typeof fn !== 'function') throw Error('pm.test needs a name and synchronous callback.');
      if (++testCount > 100) throw Error('More than 100 tests in one script.');
      try {
        const returned = fn();
        if (returned && typeof returned === 'object' && 'then' in returned)
          throw Error('Async pm.test callbacks are not supported.');
        checks.push({id:'pm-'+testCount,label:name,actual:'passed',passed:true});
      } catch(error) {
        checks.push({id:'pm-'+testCount,label:name,actual:String(error instanceof Error ? error.message : error).slice(0,300),passed:false});
      }
    },
  });
  Object.assign(globalThis,{pm,__reqdockFinish:()=>JSON.stringify({operations,checks})});
}
