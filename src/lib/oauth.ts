import type { AuthConfig, Transport } from '../types';
import { sendRequest } from './request';
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const nonce = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const secureUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.hostname === 'localhost' && url.protocol === 'http:')) throw new Error('OAuth endpoints must use HTTPS (localhost HTTP is supported for development).');
  if (url.username || url.password) throw new Error('OAuth URL credentials are forbidden.');
  return url;
};
export async function authorizePkce(auth: AuthConfig, transport: Transport, proxyKey: string): Promise<string> {
  // Open synchronously during the user gesture or popup blockers will prevent sign-in.
  const popup = window.open('about:blank', 'reqdock-oauth', 'popup=yes,width=520,height=700');
  if (!popup) throw new Error('Allow popups to start OAuth 2.0 authentication.');
  try {
    const authUrl = secureUrl(auth.authorizationUrl || '');
    const tokenUrl = secureUrl(auth.tokenUrl || '');
    if (!auth.clientId) throw new Error('Enter an OAuth client ID.');
    const verifier = nonce();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64url(new Uint8Array(digest));
    const state = nonce();
    const redirectUri = `${window.location.origin}/oauth-callback.html`;
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', auth.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    if (auth.scope) authUrl.searchParams.set('scope', auth.scope);
    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('OAuth sign-in timed out.')); }, 120000);
      const interval = setInterval(() => { if (popup.closed) { cleanup(); reject(new Error('OAuth popup closed.')); } }, 500);
      function cleanup() { clearTimeout(timeout); clearInterval(interval); window.removeEventListener('message', receive); }
      function receive(event: MessageEvent) {
        if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== 'reqdock:oauth2') return;
        cleanup();
        try {
          const result = new URL(event.data.href);
          if (result.origin !== window.location.origin || result.pathname !== '/oauth-callback.html' || result.searchParams.get('state') !== state) throw new Error('OAuth state validation failed.');
          if (result.searchParams.has('error')) throw new Error(result.searchParams.get('error_description') || result.searchParams.get('error') || 'OAuth authorization failed.');
          const value = result.searchParams.get('code');
          if (!value) throw new Error('OAuth callback is missing an authorization code.');
          resolve(value);
        } catch (error) { reject(error); }
      }
      window.addEventListener('message', receive);
      popup.location.href = authUrl.toString();
    });
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: auth.clientId, code_verifier: verifier });
    const response = await sendRequest({ url: tokenUrl.toString(), method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }, transport, new AbortController().signal, proxyKey);
    const json: unknown = JSON.parse(response.text);
    if (!json || typeof json !== 'object' || !('access_token' in json) || typeof json.access_token !== 'string') throw new Error('OAuth token endpoint did not return access_token.');
    return json.access_token;
  } finally { if (!popup.closed) popup.close(); }
}
