# ReqDock D1 deployment and acceptance checklist

GitHub Actions verifies the code, but does not migrate the Cloudflare D1 database.

## Before migration
- Confirm Cloudflare Pages has D1 binding REQDOCK_DB and secret REQDOCK_SYNC_KEY.
- Use the actual D1 database name for YOUR_D1_DATABASE below, not the binding name.
- Confirm Wrangler is authenticated to the correct Cloudflare account.
- Export a local ReqDock JSON backup before any destructive restore.
- From the repository root, back up remote D1:

    npx wrangler d1 export YOUR_D1_DATABASE --remote --output=reqdock-before-migration.sql

Keep the export securely. Do not commit it or any secret.

## Determine which migrations are needed
Inspect D1 schema:

    npx wrangler d1 execute YOUR_D1_DATABASE --remote --command "PRAGMA table_info(reqdock_snapshots);"
    npx wrangler d1 execute YOUR_D1_DATABASE --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='reqdock_snapshot_history';"

Migration order (run each missing migration exactly once):

    npx wrangler d1 execute YOUR_D1_DATABASE --remote --file=migrations/0001_sync.sql
    npx wrangler d1 execute YOUR_D1_DATABASE --remote --file=migrations/0002_sync_revision.sql
    npx wrangler d1 execute YOUR_D1_DATABASE --remote --file=migrations/0003_sync_history.sql

- Run 0001 only if the reqdock_snapshots table does not exist.
- Run 0002 only if that table has no revision column (ALTER TABLE is not idempotent).
- Run 0003 only if the reqdock_snapshot_history table does not exist; it backfills the current encrypted snapshot and creates retention triggers.
- New installations need all three in order.

## Verify production D1
The following commands are read-only:

    npx wrangler d1 execute YOUR_D1_DATABASE --remote --command "SELECT revision,updated_at FROM reqdock_snapshots WHERE id='default';"
    npx wrangler d1 execute YOUR_D1_DATABASE --remote --command "SELECT revision,updated_at FROM reqdock_snapshot_history WHERE snapshot_id='default' ORDER BY revision DESC LIMIT 20;"
    npx wrangler d1 execute YOUR_D1_DATABASE --remote --command "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('reqdock_history_on_insert','reqdock_history_on_update');"

New databases can legitimately contain zero snapshots. An existing snapshot should have a revision and a matching history row. Both triggers should exist.

## Pages and end-to-end acceptance
1. Confirm Cloudflare Pages deployed the latest main commit and includes Pages Functions. Passing GitHub CI alone does not prove Pages is deployed.
2. Export a local JSON backup of your ReqDock workspace.
3. Open Cloud Sync; enter the server sync key and the original encryption passphrase used by existing snapshots.
4. Review changes. Resolve concurrent-edit conflicts explicitly, then confirm.
5. Verify the revision increases; open List history and inspect the new revision.
6. On a second device/browser, sync new records and verify both devices' additions survive.
7. Modify the same record on each device before syncing and confirm the conflict review forces a choice.
8. Enable session auto sync and close the dialog. Wait approximately one minute or return focus to the tab. The cloud icon indicates status.
9. Reload the page. Confirm the automatic session has stopped and both credentials are blank.

Do NOT test destructive historical restore against irreplaceable production data. Use a disposable workspace or separate test D1 database.

## Rules and troubleshooting

- Stored cloud snapshots, history and local sync baseline are encrypted AES-GCM data. Passphrases are not recoverable.
- Stale revision PUT: HTTP 409; re-review cloud changes instead of retrying blindly.
- Legacy unversioned PUT: HTTP 428; update the app first.
- Cloud sync unavailable: HTTP 503; inspect D1 binding and Pages secret.
- Missing revision column: D1 500, apply migration 0002 once.
- Missing history table: history endpoint 500, apply migration 0003 once.
- History retains the latest 20 revisions, not 20 days.
- Auto sync is opt-in per visible browser tab. It stops on conflict/error and never chooses winners silently.
- Cookies and Local Agent pairing tokens are not included in cloud snapshots. User-supplied request headers and gRPC Metadata are encrypted with the workspace.
- Local JSON exports are plaintext; protect them.
- This is a shared-key single-workspace model, not per-user RBAC or background server scheduling.
