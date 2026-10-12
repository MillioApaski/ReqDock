# ReqDock

**A local-first API workspace for the web.** Build, send, and inspect HTTP requests in a lightweight browser client. Deploy the UI on Cloudflare Pages, with an optional locked-down Pages Functions proxy.

> Development preview (v0.2). A browser-based API client, not a drop-in replacement for every Postman feature.

## Features

- GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS requests
- Query params, custom headers, JSON/text/x-www-form-urlencoded bodies
- Bearer Token, Basic Auth, and API Key authorization
- Collections, nested folders, request naming and moving, history (last 100), and IndexedDB persistence
- Environments and `{{variable}}` interpolation, plus `{{$timestamp}}` and `{{$guid}}`
- Syntax-highlighted response and JSON folding with CodeMirror; raw response and header views
- Direct browser requests and optional Cloudflare Pages Functions proxy
- cURL import / export, Postman Collection v2.1 and Environment import/export, ReqDock v1/v2 JSON backups
- Collection Runner with sequential HTTP requests, safe declarative response assertions and JSON reports
- GraphQL POST bodies with JSON variables, multipart/form-data text fields and one transient file attachment
- OAuth 2.0 Authorization Code + PKCE (public clients), direct WebSocket and SSE debugging with log export
- Dark/light theme and responsive layout

## Quick start

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. `npm run dev` runs the UI only; the optional proxy route is not available until started with Wrangler.

```bash
npm run test
npm run build
npm run pages:dev
```

`pages:dev` serves the production build through Wrangler, including Pages Functions. For local proxy testing, add a `.dev.vars` file (never commit it):

```dotenv
REQDOCK_ALLOWED_HOSTS=api.example.com,jsonplaceholder.typicode.com
REQDOCK_PROXY_KEY=use-a-long-random-secret
```

In the UI, switch to **Proxy**, open its settings, and enter the matching key. HTTP API requests sent in **Direct** mode use browser `fetch()` and must obey the destination server's CORS policy.

## Cloudflare Pages deployment

1. In Cloudflare Dashboard → Workers & Pages → Create → Pages, connect the `MillioApaski/ReqDock` GitHub repository.
2. Framework preset: **Vite** (or none). Build command: `npm run build`. Build output directory: `dist`. Project root: repository root.
3. Pages Functions are picked up automatically from the root-level `functions/` folder on Git-based deployments.
4. Optional: under Pages → Settings → Variables and Secrets, configure **both**:
   - `REQDOCK_ALLOWED_HOSTS` as a comma-separated list of **exact public DNS hostnames**, no wildcard (example: `api.example.com,jsonplaceholder.typicode.com`).
   - `REQDOCK_PROXY_KEY` as a strong **secret** value. Avoid putting it in a public environment variable prefixed with `VITE_`.
5. Redeploy after updating runtime variables. In the UI, enter the secret in Proxy settings. It is held only in memory and is not stored with requests.
6. For defense in depth, protect the Pages app **and `/api/proxy` route** using Cloudflare Access. Add WAF/rate limits if the app is exposed publicly.

The proxy refuses all requests until configured, and is restricted to exact allowlisted DNS hosts. It blocks IP-literal, localhost, special local hostnames, nonstandard ports, embedded URL credentials, and automatic redirects. Its request and response preview limits are **1 MiB** and **2 MiB**, respectively. It does not follow redirects. This is not a general-purpose public HTTP relay. DNS resolution can change after validation; use only trusted allowlist hosts.

**Important:** Free-tier capacity and restrictions may change. This is a development tool and not suitable for sensitive secrets on shared or untrusted computers. Auth values and environment variables are stored in the browser's IndexedDB, not encrypted at rest. Exported backups can contain credentials. Protect them accordingly.

## Known limitations

- Direct-mode requests can fail because of CORS, mixed-content restrictions, or browser networking rules. Cloud Proxy cannot reach `localhost`, RFC1918 addresses, or private services.
- Multipart uploads have a **one-file-per-request** UI for now; files remain memory-only and are not persisted, included in imports/exports, or replayed by Collection Runner. Cloud Proxy uploads are limited to approximately 700 KiB because files are base64 encoded into a 1 MiB capped JSON payload.
- OAuth 2.0 supports **Authorization Code + PKCE** only. Register `<your-origin>/oauth-callback.html` with the provider. Token endpoints must enable browser CORS or be allowlisted for the Cloud Proxy. Tokens are not auto-refreshed.
- Browser WebSocket connections cannot set arbitrary headers. SSE supports browser-direct streaming only; Cloud Proxy does not stream SSE.
- Assertion rules are simple declarative checks for status, duration, header, JSON path and substring; no arbitrary Postman JavaScript sandbox or pre-request scripts.
- No multi-user cloud synchronization, scheduled collection runs, gRPC, built-in local-network agent, or complete Postman scripting compatibility. Collection v2.1 import/export is intentionally a subset: unsupported auth types, scripts and unsupported body modes are not round-tripped.
- The proxy reads a response into a capped preview buffer, rather than streaming arbitrary-sized downloads.
- cURL import supports common portable options and explicitly rejects unsupported switches.
- Workspace data is per-browser; there is no cloud sync or account system. Existing v0.1 database and backup data are migrated forward automatically.

## Stack

React, TypeScript, Vite, CodeMirror 6, Dexie/IndexedDB, Lucide, and Cloudflare Pages Functions.

## Development

```bash
npm run test
npm run build
```

The `functions/api/proxy.js` file is a Cloudflare Pages Function and does not require a separate Node server. The static build is written to `dist/`.

## AI generation disclosure

Code and documentation are generated and maintained with assistance from **OpenAI GPT-6 Sol**.

## License

GNU General Public License v3.0. See [LICENSE](./LICENSE).
