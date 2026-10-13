# ReqDock

> **v1.2 gRPC Client/Bidirectional Streaming:** Interactive RPC sessions via loopback Local Agent. Start, repeatedly send JSON messages, Half-close sending, and Cancel. Bidirectional response events stream incrementally. Sessions are memory-only, use the existing origin/token/host security policy, and expire after 40 seconds (gRPC deadline: 25 seconds).

> **v1.1 gRPC Server Streaming + saved RPC requests:** Receive incremental server-stream messages with cancel/timeout/bounds. Save gRPC request definitions into local Collections (IndexedDB), reopen and edit them. Local Agent pair tokens are never stored. Client/bidi streams and gRPC Runner remain unsupported.

> **v1.0 gRPC schema discovery:** Supports multi-file Proto imports (including folder selection) and gRPC reflection using the paired Local Agent. No imported Proto is read from the Agent filesystem. Reflection requires the destination service to enable standard reflection, and reuses the Agent allowlist and TLS policy.

> **v0.9 gRPC Unary:** A standalone RPC console using Local Agent and self-contained `.proto` definitions. Import a `.proto`, enter `grpc://host:port` or `grpcs://host:port`, the fully qualified service/method and a JSON request body. Unary only, max 2 MiB response, 25s deadline. Local Agent must be running and paired; the target host must be allowlisted. No TLS bypass, file imports, reflection or streaming yet.

> **v0.8 Local Agent:** Third transport mode for localhost and private-network HTTP APIs. Runs on the user's own computer, requires Node.js 22+, binds exclusively to `127.0.0.1:47831` and generates an ephemeral pairing token. Targets and web origins are exact allowlists. No cloud deployment change needed. HTTPS public sites may prompt to allow local network access.

**v0.7 Cookie Jar:** Optional (off by default), exact-host Cloud Proxy cookie storage in local IndexedDB. Toggle it with the Cookie icon. Supports Set-Cookie, path/expiry rules, a manual host-only entry and sequential Collection Runner reuse. Browser Direct mode cannot inspect Set-Cookie; Cookie Jar does not apply there. Cookies remain unencrypted on this device and are deliberately excluded from backups/cloud sync. Even HttpOnly-attributed values are readable by client-side JavaScript; do not use on shared/untrusted browsers.

**A local-first API workspace for the web.** Build, send, and inspect HTTP requests in a lightweight browser client. Deploy the UI on Cloudflare Pages, with an optional locked-down Pages Functions proxy.

> Development preview (v0.7). A practical local-first API client, not a protocol-level replacement for every Postman feature.

## Features

- GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS requests
- Query params, custom headers, JSON/text/x-www-form-urlencoded bodies
- Bearer Token, Basic Auth, and API Key authorization
- Request collections, nested folders, session-scoped multi-request tabs, history (last 100), and local persistence using IndexedDB
- Environments and `{{variable}}` interpolation, plus `{{$timestamp}}` and `{{$guid}}`
- Syntax-highlighted response and JSON folding with CodeMirror; raw response, headers and sandboxed HTML preview
- Direct browser requests and optional Cloudflare Pages Functions proxy; opt-in host-scoped Cookie Jar (Proxy mode only)
- cURL commands, Postman Collection v2.1, Postman environments, and OpenAPI 3.0/3.1 JSON/YAML import; ReqDock JSON backups and Postman Collection export
- Collection Runner, response assertions, sequential environment capture and safe request/response workflow scripting
- GraphQL, multipart file upload, OAuth 2.0 Authorization Code + PKCE, WebSocket and Server-Sent Events consoles
- Optional client-side encrypted Cloudflare D1 snapshots; cloud backups are opt-in and require configuration
- Dark/light theme, responsive editor-first layout, collapsible sidebar, resizable request/response split and independently scrolling panels

## Workspace layout (v0.6)

Request and response scroll independently. Drag the divider between the panels to change their height; double-click to reset, or use arrow keys while the divider is focused. The split ratio is saved locally. On desktop, toggle the Collections sidebar using the upper-left toolbar button.

The browser layout smoke suite covers desktop/mobile viewport fit, long parameter lists, and splitter persistence. Run `npm run test:e2e` after `npx playwright install chromium`.

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

## OpenAPI import (v0.5)

Use **Import OpenAPI** in the footer to import a `.json`, `.yaml`, or `.yml` OpenAPI 3.0/3.1 file (maximum 2 MiB). The importer runs entirely in your browser and never retrieves external references. It creates a collection, groups operations into folders by their first tag, and maps common query/header parameters, security schemes, server variables and JSON/form request body examples. Local JSON Pointer `$ref` entries are supported with bounded recursion.

- Imported servers using relative URLs, and specifications without servers, use `{{baseUrl}}`: set this environment variable to a fully qualified origin before sending.
- Generated `{{parameter}}` placeholders and authentication placeholders are not secrets; replace them in the request or an environment.
- YAML parsing rejects duplicate keys; remote `$ref` URLs and Swagger 2.0 specifications are intentionally unsupported.
- Importing does not automatically execute requests, follow external links, or run arbitrary scripts.

## Request tabs (v0.5)

Open any saved request from the Collections sidebar. Multiple requests can remain open simultaneously; close tabs without deleting their underlying requests. Open tab IDs are saved to sessionStorage only, while request definitions remain in IndexedDB. Response views for open tabs are kept in memory for the current session. Binary attachments remain in memory and are cleared on request selection.

## Known limitations

- Direct-mode requests may fail because of CORS, mixed-content restrictions, or browser networking rules. Cloud Proxy cannot reach localhost, RFC1918 addresses, or private services.
- The proxy reads a response into a capped preview buffer, rather than streaming arbitrary-sized downloads.
- cURL import supports common portable options and explicitly rejects unsupported switches.
- Only safe declarative scripting is supported; arbitrary Postman JavaScript sandbox scripts cannot run.
- gRPC, local-network agents, complete Cookie Jar management, full Postman scripting compatibility and multi-user cloud conflict resolution are not yet implemented.
- Encrypted cloud backup is an optional manual snapshot workflow, not automatic sync. No account or team collaboration system exists.

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

## Optional encrypted Cloudflare D1 backups

Cloud backup is **disabled by default**. ReqDock can upload and restore one encrypted workspace snapshot, but it cannot configure your Cloudflare account automatically. You must create a D1 database, initialize its schema, and bind it to Pages Functions:

1. In Cloudflare, create a D1 database named `reqdock-sync`.
2. Apply [`migrations/0001_sync.sql`](./migrations/0001_sync.sql) to that database using the D1 console or Wrangler.
3. Under Pages → Settings → Bindings, add a **D1 database** binding with the variable name **`REQDOCK_DB`** pointing to the database.
4. Under Pages → Settings → Variables and Secrets, create a strong, random, **secret** named **`REQDOCK_SYNC_KEY`**. Redeploy so Functions picks up the new bindings.
5. In ReqDock, open the cloud icon in the top bar. Enter the server sync key and a **separate encryption passphrase** of at least 12 characters. Upload or restore manually. Never put either secret in GitHub or environment variables prefixed with `VITE_`.

AES-256-GCM encryption runs in the browser, using a key derived with PBKDF2-SHA-256 (250,000 iterations, random salt). The server stores only an authenticated encrypted envelope. The secret sync key authorizes access to the endpoint; the encryption passphrase is not sent to the server. Both values remain in browser memory, not localStorage or IndexedDB, and are cleared when closing the dialog. Use a strong unique passphrase and back it up safely: lost passphrases mean permanent loss of cloud data.

**Limitations:** The endpoint is intended for one private workspace, not multiple independent users. Each upload replaces the previous snapshot, and restoring replaces local workspace data. There is no automatic merging, conflict resolution, background synchronization, or password recovery. The JSON API body is capped at 1 MiB. Require Cloudflare Access protection and rate limiting on `/api/sync` for additional security. D1 backups are not a substitute for independent local exports.


## Local Agent: localhost and private-network API calls

From a terminal **on the computer running your browser**, clone this repository and start:

```bash
npm install
npm run agent
# For a specific private API:
npm run agent -- --allow-hosts=192.168.1.100,api.home.test
```

The Agent listens only on `http://127.0.0.1:47831`, including when you allow a LAN destination.
It allows `localhost`, `127.0.0.1`, `[::1]` by default; other **target hosts** must be explicitly listed.
Copy the one-time terminal token into **ReqDock → Agent → Agent settings → Test connection → Use Local Agent**.
Pairing tokens are never exported, cloud-synced or persisted in browser storage. Restarting the Agent generates a new token.

Production browser Origin `https://reqdock.convert-alpha.cc` and Vite local dev origins are allowed by default.
For another hosted ReqDock domain add `--allow-origins=https://your-domain.example`.
The local agent checks the browser Origin and request Host, requires the token, never follows upstream redirects,
limits body/response sizes and blocks forwarding to its own port.
Do not reverse-proxy or publish port 47831. This is a loopback-only connector, not a public API server.
Run it on the browser computer, not on the Cloudflare host.
Chrome or other browsers may prompt for Local Network Access; grant it only for a trusted ReqDock origin.

This transport supports HTTP(S) methods, headers, auth, GraphQL, request bodies, Collection Runner,
and multipart (one file, up to 2 MiB). It does **not** tunnel WebSocket/gRPC or override certificate validation.
Direct continues to obey the browser's CORS policy; Cloud Proxy still requires its original Cloudflare configuration.

```bash
npm test
npm run build
```


## gRPC Unary (Local Agent)

The gRPC icon in the request toolbar opens the Unary Console. Start the upgraded v0.9 Local Agent
(\`npm install && npm run agent\`) and pair its token in Agent settings. It supports:

- Self-contained proto3/proto2 message/service definitions entered or imported via a single \`.proto\` file
- Fully-qualified service name (e.g. \`demo.Greeter\`), unary method name (e.g. \`SayHello\`)
- JSON request messages, optional string-valued metadata, JSON response and gRPC status/errors
- Plaintext \`grpc://host:port\` (HTTP/2) or verified-TLS \`grpcs://host:port\`; exact Agent host allowlist applies

Start: \`npm run agent -- --allow-hosts=192.168.1.100\` for LAN services.
For \`grpcs://\`, the server certificate must be trusted by Node.js. **Certificate verification is never disabled.**

**Not supported in v0.9:** imported/multiple proto files, service reflection, unary call history/Collections,
client/server/bidirectional streaming, arbitrary \`-bin\` metadata, dynamic trust certificates, or
proxying gRPC directly via Cloudflare Workers. The console does not upload proto content to a third party.
For existing gRPC APIs using \`import "google/protobuf/empty.proto";\`, provide an inlined equivalent type.


## gRPC schema discovery (v1.0)
- Choose **Local .proto files** to import multiple dependency files or a directory. Select the main file first when importing individual files. Use a folder import if relative subdirectories matter. The Agent resolves imports only from provided in-memory files, with limits of 32 files, 128 KiB per file and 512 KiB total.
- Choose **Server Reflection**, then **List services**, choose one and **Load RPC methods**. Only unary methods can be invoked. Authentication metadata is used for reflection as well.
- Reflection sends a standard gRPC request to the target over the Local Agent's allowlisted connection. It does not enumerate arbitrary hosts.
- gRPC streaming, service persistence and multi-device conflict merges remain out of scope in this version.


## gRPC Server Streaming & saved requests (v1.1)
Open the gRPC Console, select **Call mode → Server Streaming** to receive numbered messages
incrementally over a local NDJSON response. The **Cancel** button aborts the HTTP stream and
cancels the upstream gRPC call. The Agent imposes a 25-second deadline, 100-message cap
and 2 MiB JSON preview limit. Long-running streams beyond these limits are intentionally unsupported.

Save RPC settings with a name and Collection via **Save** in gRPC Console. They appear as
purple RPC entries under the chosen Collection; clicking reopens the saved definition.
The Agent pairing token is **never** saved. Proto source, JSON request and metadata
(including any authorization values) are stored unencrypted in browser IndexedDB:
do not use on a shared or untrusted browser. Saved gRPC definitions are currently
not included in existing JSON workspace backups or D1 cloud snapshots, and
the HTTP Collection Runner does not execute them.


## Interactive gRPC streaming (v1.2)

Select **Client Streaming** or **Bidirectional Streaming** in the gRPC console.
**Start session**, send one or more JSON messages using **Send message**, then use **Half-close**
to finish writing to the server. For bidirectional methods, responses appear as they arrive;
client-streaming methods return one response when the send side is half-closed.
**Cancel** aborts the RPC. Closing the console also aborts the response subscription,
which cancels the upstream gRPC call.

The Agent uses authenticated, origin-restricted, short-lived in-memory sessions. IDs are not
authentication secrets; all commands require the same ephemeral pairing token.
Up to 8 sessions per Agent process, 100 messages, 2 MiB per-direction preview and a
25-second RPC deadline. Stream sessions are not persisted; only saved RPC definitions are.
Update and restart the Local Agent to enable the new routes.
