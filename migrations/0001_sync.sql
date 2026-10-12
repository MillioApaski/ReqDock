-- Encrypted, single-workspace snapshot storage. Never store API tokens in plaintext.
CREATE TABLE IF NOT EXISTS reqdock_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
