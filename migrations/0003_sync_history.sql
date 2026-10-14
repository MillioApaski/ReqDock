-- ReqDock v1.7: append-only encrypted snapshot history.
-- Requires migrations/0001_sync.sql and migrations/0002_sync_revision.sql.
-- Applying migration backfills the current v1.6 snapshot if one already exists.
-- Run exactly once on the target Cloudflare D1 database.
CREATE TABLE IF NOT EXISTS reqdock_snapshot_history (
  snapshot_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, revision)
);

INSERT OR IGNORE INTO reqdock_snapshot_history (snapshot_id, revision, data, updated_at)
SELECT id, revision, data, updated_at FROM reqdock_snapshots;

-- SQLite triggers run atomically with the successful INSERT / CAS UPDATE.
-- Failed conditional UPDATEs do not create history entries.
CREATE TRIGGER IF NOT EXISTS reqdock_history_on_insert
AFTER INSERT ON reqdock_snapshots
BEGIN
  INSERT INTO reqdock_snapshot_history (snapshot_id, revision, data, updated_at)
  VALUES (NEW.id, NEW.revision, NEW.data, NEW.updated_at);
  DELETE FROM reqdock_snapshot_history
    WHERE snapshot_id = NEW.id AND revision <= NEW.revision - 20;
END;

CREATE TRIGGER IF NOT EXISTS reqdock_history_on_update
AFTER UPDATE OF data, revision ON reqdock_snapshots
BEGIN
  INSERT INTO reqdock_snapshot_history (snapshot_id, revision, data, updated_at)
  VALUES (NEW.id, NEW.revision, NEW.data, NEW.updated_at);
  DELETE FROM reqdock_snapshot_history
    WHERE snapshot_id = NEW.id AND revision <= NEW.revision - 20;
END;
