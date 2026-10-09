-- Private D1 database: NEVER put client records in this migration.
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  event_date TEXT NOT NULL CHECK (length(event_date)=10),
  client_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  brushing TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  deposit_cents INTEGER NOT NULL DEFAULT 0 CHECK(deposit_cents >= 0),
  remaining_cents INTEGER NOT NULL DEFAULT 0 CHECK(remaining_cents >= 0),
  status TEXT NOT NULL DEFAULT 'Confirmed' CHECK (status IN ('Confirmed','Pending','Completed','Cancelled')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS bookings_calendar ON bookings (event_date,start_time);
CREATE INDEX IF NOT EXISTS bookings_phone ON bookings (phone);

CREATE TABLE IF NOT EXISTS deleted_bookings (
  id TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  client_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  brushing TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  deposit_cents INTEGER NOT NULL CHECK(deposit_cents >= 0),
  remaining_cents INTEGER NOT NULL CHECK(remaining_cents >= 0),
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deletion_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS deleted_bookings_date ON deleted_bookings (deleted_at DESC);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  credential_tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  booking_id TEXT NOT NULL DEFAULT '',
  happened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
