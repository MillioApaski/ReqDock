-- Run once for existing D1 databases before deploying the new conditional sync endpoint.
ALTER TABLE reqdock_snapshots ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
