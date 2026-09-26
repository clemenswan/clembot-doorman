-- A quota on the one write path. See src/rate-limit.ts for why it counts items
-- rather than requests, and why it fails closed.
--
-- One row per key per window, upserted. `key` is the primary key rather than
-- (key, window_start) on purpose: a new window REPLACES the old row instead of
-- appending one, so this table cannot become the unbounded growth it exists to
-- prevent. The cost is that history is not kept here, which is correct. The
-- ledger is where events belong.

CREATE TABLE IF NOT EXISTS rate_limit (
  key          TEXT PRIMARY KEY,   -- 'anon:<ip>' | 'auth:<ip>' | 'global'
  window_start INTEGER NOT NULL,   -- epoch ms, floored to the window
  used         INTEGER NOT NULL    -- items charged inside this window
);

-- Sweeping old rows is optional: the table holds at most one row per distinct
-- caller ever seen, and a stale row is overwritten on that caller's next
-- request. This index makes an occasional cleanup cheap if it is ever wanted.
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit (window_start);
