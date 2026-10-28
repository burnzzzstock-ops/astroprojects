-- The manager's side of the web version (call outcomes, notes, hidden dealers).
-- Safe to run on every deploy: nothing here drops or changes existing data.
CREATE TABLE IF NOT EXISTS car_state (
  key                TEXT PRIMARY KEY,   -- VIN (or source:id), same key the scan uses
  status             TEXT,               -- new | working | negotiating | bought | passed
  next_call_day      TEXT,               -- YYYY-MM-DD (Central) it's due again
  last_call_at       TEXT,
  last_outcome       TEXT,
  price_at_last_call INTEGER,
  offer              INTEGER,
  notes              TEXT,
  bought_at          TEXT
);
CREATE TABLE IF NOT EXISTS calls (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  key     TEXT NOT NULL,
  outcome TEXT NOT NULL,
  notes   TEXT,
  offer   INTEGER,
  price   INTEGER,
  at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_at ON calls (at);
CREATE TABLE IF NOT EXISTS hidden (
  dealer_key TEXT PRIMARY KEY,
  name       TEXT,
  at         TEXT
);
CREATE TABLE IF NOT EXISTS prefs (    -- the current filter + saved searches, one row
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pin_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pin_failures_ip ON pin_failures (ip, at);
