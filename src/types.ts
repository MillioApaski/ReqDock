export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type BodyType = 'none' | 'json' | 'text' | 'urlencoded' | 'graphql' | 'form-data';
export type Transport = 'direct' | 'proxy' | 'agent';
export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key' | 'oauth2';
export type Tab = 'params' | 'headers' | 'auth' | 'body' | 'tests';
export type KeyValue = { id: string; key: string; value: string; enabled: boolean };
export type AuthConfig = { type: AuthType; token: string; username: string; password: string; key: string; value: string; location: 'header' | 'query'; authorizationUrl?: string; tokenUrl?: string; clientId?: string; scope?: string };
export type RequestModel = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  bodyType: BodyType;
  body: string;
  graphqlVariables?: string;
  auth: AuthConfig;
  updatedAt: number;
  collectionId?: string;
  folderId?: string;
  /** Optional JSON assertion rules executed after the request. */
  assertions?: Assertion[];
  preScript?: string;
  postScript?: string;
};
export type GrpcRequestPreset = {
  id: string;
  name: string;
  collectionId: string;
  updatedAt: number;
  target: string;
  proto: string;
  entryName: string;
  protoFiles: { name: string; content: string }[];
  source: 'files' | 'reflection';
  service: string;
  method: string;
  message: string;
  metadata: string;
  callMode: 'unary' | 'server-stream';
};
export type Collection = { id: string; name: string; createdAt: number };
export type Folder = { id: string; name: string; collectionId: string; parentId?: string };
export type Assertion = { id: string; kind: 'status' | 'duration' | 'json' | 'header' | 'contains'; target: string; expected: string };
export type Environment = { id: string; name: string; variables: KeyValue[] };
export type CookieRecord = { id: string; name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expiresAt: number | null; updatedAt: number };
export type SavedResponse = { setCookies?: string[]; status: number; statusText: string; headers: KeyValue[]; text: string; bodyBase64?: string; contentType: string; duration: number; size: number; redirected?: boolean };
export type HistoryItem = { id: string; at: number; request: RequestModel; status?: number; duration?: number; error?: string };
export const newId = () => crypto.randomUUID();
export const blankPair = (): KeyValue => ({ id: newId(), key: '', value: '', enabled: true });
export const newAuth = (): AuthConfig => ({ type: 'none', token: '', username: '', password: '', key: '', value: '', location: 'header' });
export const newRequest = (): RequestModel => ({
  id: newId(), name: 'Untitled Request', method: 'GET', url: '', headers: [blankPair()], bodyType: 'json',
  body: '{\n  \n}', auth: newAuth(), updatedAt: Date.now(),
});
export const exampleRequest = (): RequestModel => ({
  ...newRequest(), name: 'Example · JSONPlaceholder', method: 'GET',
  url: 'https://jsonplaceholder.typicode.com/todos/1',
});
