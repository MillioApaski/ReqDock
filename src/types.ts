export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type BodyType = 'none' | 'json' | 'text' | 'urlencoded';
export type Transport = 'direct' | 'proxy';
export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key';
export type Tab = 'params' | 'headers' | 'auth' | 'body';
export type KeyValue = { id: string; key: string; value: string; enabled: boolean };
export type AuthConfig = { type: AuthType; token: string; username: string; password: string; key: string; value: string; location: 'header' | 'query' };
export type RequestModel = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  bodyType: BodyType;
  body: string;
  auth: AuthConfig;
  updatedAt: number;
};
export type Environment = { id: string; name: string; variables: KeyValue[] };
export type SavedResponse = { status: number; statusText: string; headers: KeyValue[]; text: string; bodyBase64?: string; contentType: string; duration: number; size: number; redirected?: boolean };
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
