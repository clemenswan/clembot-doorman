-- mcp-scorecard schema. D1 (SQLite).
-- Three concerns: work queued (pending), work finished (audits), work published (allowlist).

-- An audit is one graded server at one point in time, by one model.
-- Rows are append-only: a re-grade is a NEW row. Grades are model-relative,
-- so history must stay readable.
CREATE TABLE IF NOT EXISTS audits (
  id              TEXT PRIMARY KEY,          -- uuid
  server_url      TEXT NOT NULL,
  server_name     TEXT,                      -- from MCP server_info
  needed_for      TEXT,                      -- caller's stated purpose; seeds Cold Open
  status          TEXT NOT NULL,             -- queued|running|complete|failed
  grade           TEXT,                      -- A|B|C|F
  score           REAL,                      -- 0-100 final weighted
  static_pct      REAL,                      -- mcpscore normalised 0-100
  behavioral_pct  REAL,
  guidance_pct    REAL,                      -- NULL when not measured
  hard_fail       TEXT,                      -- NULL, or reason string
  model           TEXT,                      -- pinned model id. Grade is relative to it.
  mcpscore_version TEXT,
  grade_json      TEXT,                      -- full grade.json blob
  report_md       TEXT,
  recipe_md       TEXT,
  evidence_sha256 TEXT,                      -- hash of the evidence bundle
  anchor_tx       TEXT,                      -- Hedera/0G tx id, NULL until anchored
  error           TEXT,
  created_at      TEXT NOT NULL,
  completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audits_server  ON audits(server_url, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_status  ON audits(status, created_at);

-- Full probe transcripts. Evidence: never truncated, never edited, never deleted.
-- One row per probe RUN (probe x run_index), holding JSONL of every turn.
CREATE TABLE IF NOT EXISTS transcripts (
  id          TEXT PRIMARY KEY,
  audit_id    TEXT NOT NULL REFERENCES audits(id),
  probe_id    TEXT NOT NULL,                 -- cold_open|ambiguity|bad_input|chain|injection_sniff
  run_index   INTEGER NOT NULL,              -- 0..2, three runs per probe
  score       REAL,                          -- this run's sub-score 0-100
  jsonl       TEXT NOT NULL,                 -- newline-delimited turn records
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcripts_audit ON transcripts(audit_id, probe_id, run_index);

-- Work waiting for a runner. The Worker cannot run mcpscore (Python + native
-- deps), so /grade enqueues here and a laptop runner claims the row.
CREATE TABLE IF NOT EXISTS pending (
  id          TEXT PRIMARY KEY,              -- == audits.id
  server_url  TEXT NOT NULL,
  needed_for  TEXT,
  requested_by TEXT,                         -- owner key, free text for v1
  claimed_at  TEXT,                          -- NULL = unclaimed
  claimed_by  TEXT,                          -- runner id
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_unclaimed ON pending(claimed_at, created_at);

-- Published trust list. What the doorman hook reads (via a synced local file,
-- never a live call). One row per owner+server.
CREATE TABLE IF NOT EXISTS allowlist (
  owner       TEXT NOT NULL,
  server_url  TEXT NOT NULL,
  decision    TEXT NOT NULL,                 -- allow|deny
  grade       TEXT,
  audit_id    TEXT REFERENCES audits(id),
  note        TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (owner, server_url)
);

-- Append-only spend + action ledger. Drives the demo site's live log.
CREATE TABLE IF NOT EXISTS ledger (
  id          TEXT PRIMARY KEY,
  audit_id    TEXT,
  event       TEXT NOT NULL,                 -- queued|claimed|graded|denied|paid|anchored|error
  detail      TEXT,
  amount_usd  REAL,                          -- x402 spend, NULL for non-payment events
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_time ON ledger(created_at DESC);
