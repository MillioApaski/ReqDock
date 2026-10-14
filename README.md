# ReqDock

> **v1.7 Encrypted Cloud History:** Last 20 revisions retained atomically in D1 using SQLite triggers. Browse encrypted history, preview a revision locally, and recover it as a NEW revision through normal CAS protection. Requires one-time migration 0003_sync_history.sql. No passphrases or plaintext workspace content are sent to Cloudflare.

> **v1.6 Conflict-safe multi-device sync:** D1 revision CAS blocks stale uploads; manual encrypted three-way merge detects simultaneous edits and edit/delete races across HTTP, gRPC, Collections, Folders and Environments. Browsers retain encrypted last-sync baselines, resolve per-record conflicts interactively and refuse silent overwrites. Requires migration 0002_sync_revision.sql.

> **v1.5 Postman script compatibility:** Opt-in synchronous `pm.*` APIs in a QuickJS Web Worker. Supports response tests, variable management and common Chai-style assertions; existing ReqDock DSL stays the default. Imported request-level Postman v2.1 events are retained. No external networking, modules, timers, asynchronous callbacks or full Postman Sandbox compatibility.

> **v1.4 gRPC Collection Runner:** Sequential local execution of saved Unary and all streaming RPCs. Interactive Client/Bidi requests use the saved JSON object, or an array of message objects, then automatically half-close. Includes progress, cancellation and credential-free JSON reports. Requires paired Local Agent; no cloud gRPC relay.

> **v1.3 Complete workspace backups:** ReqDock JSON v3 backups and encrypted Cloudflare D1 snapshots now include saved gRPC RPCs, including imported Proto definitions and Metadata. Backward-compatible with v1/v2 backups. Cookie Jar and ephemeral Agent tokens remain excluded.

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


## gRPC backups (v1.3)
ReqDock local JSON backup **v3** includes saved gRPC RPC definitions (target, Service, Method, Proto
and dependencies, JSON message and metadata, streaming mode) alongside existing HTTP requests,
Collections and environments. Older v1/v2 backups can still be imported. Import merges matching IDs,
consistent with the existing HTTP backup import workflow. Cloud backup now uses the same v3
payload *inside the existing AES-256-GCM encrypted envelope*. Restoring a cloud snapshot **replaces**
local gRPC RPCs too (older snapshots have none).

**Important:** Metadata may contain API credentials. Downloaded JSON exports are not encrypted
and should be protected accordingly. Agent pairing tokens and Cookie Jar data remain excluded.
Existing Cloudflare D1 schema and Pages configuration do not need changes.


## gRPC Collection Runner (v1.4)

Open Collection Runner, choose **gRPC**, select a Collection and click **Run collection**.
Requires Local Agent running with the target hosts in its allowlist and an in-memory pairing token.
Unary, Server Streaming, Client Streaming and Bidirectional Streaming are executed sequentially.
For client/bidirectional RPCs, put a JSON object or an array of message objects in the saved RPC
Request body. The Runner sends each item and automatically half-closes the input stream.

The Runner retains only per-request status, duration, number of response messages and error
message in the downloadable report, not request payloads, authorization metadata, Agent tokens
or response content. HTTP Runner keeps its existing transport, assertions and environment
capture behavior. Environment placeholders work for gRPC target, metadata and JSON body.
The order of gRPC runs is ascending saved update timestamp, then name; HTTP and gRPC
queues are distinct to avoid surprising cross-protocol executions.


## Postman scripts (v1.5)

Under the request **Tests** tab select **Script language → Postman JS**. Use common
Postman-compatible calls: pm.environment.get/set/unset, pm.variables.get/set,
pm.response.code/json()/text()/headers.get, pm.test and pm.expect(...).to.eql/equal,
include, property, lengthOf, above, below and basic type assertions.
Both Send and HTTP Collection Runner execute the same before/after scripts;
failed pm.test assertions appear in the response test results and runner report.

Scripts execute in a disposable Web Worker with a fresh, self-contained QuickJS
runtime, no browser/Node I/O capabilities, no network APIs, and strict memory/
CPU/wall-clock budgets. Importing scripts does NOT run them automatically;
the user must send the request or run the collection.
Not supported: require(), pm.sendRequest(), timers, async/await asynchronous
operations, full Chai.js syntax or complete Postman Sandbox behavior.
The original ReqDock script language is still available for older requests.

Postman Collection v2.1 request-level prerequest/test event arrays are imported
and re-exported. Collection/folder-level inherited scripts are not executed.


## Conflict-safe encrypted multi-device sync (v1.6)

**Database migration is required before deploying the new sync API:**
\`npx wrangler d1 execute <YOUR_DATABASE_NAME> --remote --file=migrations/0002_sync_revision.sql\`
Use your actual D1 database name (not the binding variable). Run this migration **once**
on existing installations; for new databases apply migration 0001 first, then 0002.
Existing snapshots receive revision 1.

Click Cloud Sync, enter your separate server authentication key and encryption
passphrase, then **Review sync changes**. The browser decrypts cloud data and
performs a three-way entity merge: current local, cloud and encrypted baseline
from the last successful sync. On a new device without a baseline, sync performs
a conservative two-way union treating both sides as additions. Conflicting edits
or delete-vs-edit races require an explicit choice of local/cloud per affected
record; no arbitrary field-level combination of passwords or protobuf content.
The app preserves parent Collections/Folders if referenced by merged requests.

**Confirm synchronized merge** encrypts the result, sends it with an expected
D1 revision and refreshes local data. Server-side atomic compare-and-swap
ensures concurrent/stale uploads fail with HTTP 409; the user must re-review
updated cloud data. Legacy unversioned PUT requests now fail with HTTP 428.
If local data changes during upload, the app preserves those edits and records
the encrypted cloud baseline so the next sync reconciles them. Restore cloud
remains a destructive operation, requiring confirmation. **Export a local backup
before restoring.** Tokens used for Local Agent and browser cookies are excluded.

Passphrases and server sync keys are memory-only and discarded when closing the
dialog. The device baseline is stored only as encrypted data in IndexedDB.
This release supports explicit/manual Sync; it is not background replication,
multi-tenant accounts or automatic conflict resolution.


## Encrypted cloud revision history (v1.7)

Before using Cloud History on an existing database, run the following **once** (after 0001 and 0002):
\`npx wrangler d1 execute YOUR_DATABASE_NAME --remote --file=migrations/0003_sync_history.sql\`

This creates an append-only encrypted revision history table and SQLite triggers, and backfills the current
snapshot (if any) into history. Each successful D1 insert or conditional update creates a history
entry **in the same SQL transaction**. Failed/stale writes do not create a history row.
Only the 20 most recent revisions remain (history retention is bounded by count, not days).

Open the encrypted sync panel, supply the server sync key and encryption passphrase, and click
**List history**. Choose a revision with **Inspect**. The browser fetches that encrypted snapshot,
decrypts it locally, and shows record counts. **Restore as new revision** explicitly confirms the
destructive action, publishes the chosen historical ciphertext with the *current* expected cloud
revision (atomic CAS), then replaces local data if it has not changed since inspection.
Other devices that still hold an older baseline will detect the new revision during their
next manual sync. Concurrent changes return HTTP 409 and require a fresh inspection.

No decrypted history data or passphrase is stored in D1. Older snapshots with different
encryption passphrases cannot be inspected with the current passphrase.
Cloud recovery remains manual and may replace local requests; export a JSON backup first.
The existing **Restore cloud** button recovers the latest snapshot without creating a new revision.

The Cloud History API extends the same authenticated endpoint:
\`GET /api/sync?history=1\` returns revision metadata; \`GET /api/sync?revision=N\`
returns a single encrypted archived snapshot. Existing unversioned GET and CAS PUT
semantics remain unchanged. Migration 0003 is required for the new history endpoints only;
the ordinary snapshot endpoint can continue functioning without it.
