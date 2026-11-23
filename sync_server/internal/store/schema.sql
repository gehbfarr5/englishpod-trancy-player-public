-- EP-SYNC-001 v1.0 SQLite schema (WAL mode)

CREATE TABLE IF NOT EXISTS sync_groups (
  group_id              TEXT PRIMARY KEY,
  server_seq            INTEGER NOT NULL DEFAULT 0,
  last_opened_lesson_id TEXT,
  last_opened_at_ms     INTEGER NOT NULL DEFAULT 0,
  last_opened_by        TEXT,
  last_opened_seq       INTEGER NOT NULL DEFAULT 0,
  created_at_ms         INTEGER NOT NULL,
  updated_at_ms         INTEGER NOT NULL,
  orphaned_at_ms        INTEGER
);

CREATE TABLE IF NOT EXISTS sync_devices (
  device_id       TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES sync_groups(group_id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  device_name     TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (
                    platform IN ('ios', 'ipad', 'android', 'web', 'wechat', 'harmonyos')
                  ),
  created_at_ms   INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  revoked_at_ms   INTEGER
);

CREATE TABLE IF NOT EXISTS pairing_tickets (
  code_hash      TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES sync_groups(group_id) ON DELETE CASCADE,
  created_by     TEXT NOT NULL,
  created_at_ms  INTEGER NOT NULL,
  expires_at_ms  INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  consumed_by    TEXT
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  group_id         TEXT NOT NULL REFERENCES sync_groups(group_id) ON DELETE CASCADE,
  lesson_id        TEXT NOT NULL,
  lesson_completed INTEGER NOT NULL DEFAULT 0,
  completed_at_ms  INTEGER NOT NULL DEFAULT 0,

  pb_position_ms   INTEGER,
  pb_segment_index INTEGER,
  pb_duration_ms   INTEGER,
  pb_updated_at_ms INTEGER NOT NULL DEFAULT 0,
  pb_updated_by    TEXT,
  pb_seq           INTEGER NOT NULL DEFAULT 0,

  dg_position_ms   INTEGER,
  dg_segment_index INTEGER,
  dg_duration_ms   INTEGER,
  dg_updated_at_ms INTEGER NOT NULL DEFAULT 0,
  dg_updated_by    TEXT,
  dg_seq           INTEGER NOT NULL DEFAULT 0,

  seq              INTEGER NOT NULL,
  PRIMARY KEY (group_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_group_seq ON lesson_progress(group_id, seq);
CREATE INDEX IF NOT EXISTS idx_devices_group_active      ON sync_devices(group_id, revoked_at_ms);
CREATE INDEX IF NOT EXISTS idx_tickets_expires           ON pairing_tickets(expires_at_ms);
