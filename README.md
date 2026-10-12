# ReqDock

**A local-first API workspace for the web.** Build, send, and inspect HTTP requests in a lightweight browser client. Deploy the UI on Cloudflare Pages, with an optional locked-down Pages Functions proxy.

> Early preview (v0.1). This is not a full Postman replacement yet.

## Features

- GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS requests
- Query params, custom headers, JSON/text/x-www-form-urlencoded bodies
- Bearer Token, Basic Auth, and API Key authorization
- Request collections, editable names, history (last 100), and local persistence using IndexedDB
- Environments and `{{variable}}` interpolation, plus `{{$timestamp}}` and `{{$guid}}`
- Syntax-highlighted response and JSON folding with CodeMirror; raw response, headers and sandboxed HTML preview
- Direct browser requests and optional Cloudflare Pages Functions proxy
- cURL command import / export and ReqDock JSON backup import / export
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
- No multipart file upload, OAuth 2.0 workflow, pre-request scripts, collection runner, WebSocket, GraphQL specialist UI, or Postman Collection import yet.
- The proxy reads a response into a capped preview buffer, rather than streaming arbitrary-sized downloads.
- cURL import supports common portable options and explicitly rejects unsupported switches.
- Workspace data is per-browser; there is no cloud sync or account system.

## Stack

React, TypeScript, Vite, CodeMirror 6, Dexie/IndexedDB, Lucide, and Cloudflare Pages Functions.

## Development

```bash
npm run test
npm run build
```

The `functions/api/proxy.js` file is a Cloudflare Pages Function and does not require a separate Node server. The static build is written to `dist/`.

## AI generation disclosure

Code and documentation are generated and maintained with assistance from **OpenAI GPT-6**.

## License

GNU General Public License v3.0. See [LICENSE](./LICENSE).

## Workflow scripting (safe DSL)

Use the **Tests** tab to enter statements for the current request. Before-request statements update the active environment before URL/headers/body interpolation. After-response statements can extract values from JSON or headers and run equality checks. In the Collection Runner, the environment flows into the next request; if an environment is selected, updated variables are saved. Without an environment, variables are scoped to that one run.

```text
# Before request
set requestId={{$guid}}
set sentAt={{$timestamp}}

# After response
expect status=200
capture token=json.access_token
capture trace=header.X-Trace-Id
expect json.data.success=true
unset temporaryToken
```

Supported commands: `set key=value`, `unset key`, `capture key=json.path`, `capture key=header.Name`, `expect status=200`, `expect json.path=value`, `expect header.Name=value`, `expect duration=123`. Captures work only after a response. This deliberately does not execute JavaScript, so untrusted imported collections cannot run scripts silently. Scripts are limited to 200 lines.

HTML response Preview is rendered inside an iframe with a restrictive sandbox and content security policy, preventing active scripts and external network requests.
