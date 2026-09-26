-- What installs reported they needed and could not find. See src/signal.ts for
-- why the vocabulary is closed and why there is no free-text column.
--
-- There is no contributor column, and that is the design rather than a field
-- nobody got round to. A contribution is a count with no contributor attached,
-- which rules out reputation and per-install history permanently and is the
-- reason this endpoint needs no privacy policy beyond the sentence it prints.
--
-- One row per (kind, term, day), upserted. The table grows with the vocabulary
-- and the calendar, never with traffic: twelve capability terms plus however
-- many distinct server names the gate refuses, times the number of days.

CREATE TABLE IF NOT EXISTS signal_count (
  kind TEXT NOT NULL,           -- 'gap' | 'blocked'
  term TEXT NOT NULL,           -- a taxonomy id, or a server name as the gate sees it
  day  TEXT NOT NULL,           -- UTC date, YYYY-MM-DD. Nothing finer, on purpose.
  n    INTEGER NOT NULL,
  PRIMARY KEY (kind, term, day)
);

-- The aggregate groups by (kind, term) and takes MIN(day). Without this the
-- read is a full scan of every day ever recorded.
CREATE INDEX IF NOT EXISTS idx_signal_kind_term ON signal_count (kind, term);
