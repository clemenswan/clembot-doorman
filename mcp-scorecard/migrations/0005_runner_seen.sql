-- Whether anything is listening. See src/runner-presence.ts for why the
-- heartbeat records the POLL rather than the CLAIM: a runner polling an empty
-- queue claims nothing, so claims cannot tell a healthy quiet day apart from
-- no runner at all.
--
-- One row per runner id, upserted and throttled to one write a minute, so this
-- table stays the size of the runner fleet rather than the size of its uptime.

CREATE TABLE IF NOT EXISTS runner_seen (
  runner    TEXT PRIMARY KEY,
  last_seen TEXT NOT NULL      -- ISO 8601
);
