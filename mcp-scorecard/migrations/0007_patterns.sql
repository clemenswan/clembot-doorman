-- Pattern cards and published reference profiles.
--
-- D1, not KV. There is no KV namespace on this Worker and adding one to hold
-- ten rows would be a second storage engine to back up, migrate and reason
-- about, for data that is already relational: a card belongs to a dimension
-- and names a check.
--
-- Both tables are PUBLIC READ and sit on NEVER_PAID alongside /feed. Invariant
-- 22 says the tape is never chargeable; a pattern card is the same kind of
-- thing. It tells somebody what is wrong with their own build, and a finding
-- you have to pay to read is a finding you cannot act on.

CREATE TABLE IF NOT EXISTS patterns (
  -- The CHECK ID from the rubric. One card per check that can fail, so this
  -- is a natural key and a drift detector at once: a card with no matching
  -- check id is a card for a check that was renamed or deleted.
  id            TEXT PRIMARY KEY,
  dimension     INTEGER NOT NULL,
  title         TEXT NOT NULL,
  -- Two or three sentences on why this matters, written once, by a human.
  why           TEXT NOT NULL,
  -- What to add or change, at file level.
  fix           TEXT NOT NULL,
  -- S, M or L. Not hours: an hour estimate for somebody else's repo is a
  -- number nobody can check, which is what invariant 9 is about.
  effort        TEXT NOT NULL,
  evidence_url  TEXT,
  -- JSON array of server urls from the graded feed that help close this.
  -- Usually empty and honestly so: most of these gaps are configuration, and
  -- no MCP server fixes a missing deny list.
  graded_mcps   TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patterns_dimension ON patterns(dimension, id);

-- Published reference profiles.
--
-- EMPTY ON PURPOSE in v1. The decision was bundle-only: the Clembot reference
-- ships inside the plugin and nothing is published yet. The route and the
-- table exist so the client code is final and a later publish is a seed, not
-- a release. Until then GET /profiles/:name answers 404, which is the honest
-- answer to "is there a published profile" rather than a stub that looks like
-- one.
CREATE TABLE IF NOT EXISTS profiles (
  name        TEXT PRIMARY KEY,
  body        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);
