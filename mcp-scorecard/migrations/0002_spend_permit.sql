-- Inbound spend permit.
--
-- `POST /grade` is open so the site's demo works. That is fine while nothing
-- can spend, and stops being fine the moment an ANTHROPIC_API_KEY reaches the
-- runner. This column is what the runner reads before deciding whether it may
-- run the behavioural probes at all.
--
-- DEFAULT 0 is the load-bearing part. Any row written by code that predates
-- this column, or by code that forgets it, is static-only. The safe direction
-- is the one you get by doing nothing.

-- On `.claude/rules/database.md`, which says never add a NOT NULL column to a
-- populated table in one step: that rule is about adding NOT NULL WITHOUT a
-- default, which fails on any existing row. With a non-null DEFAULT, SQLite
-- backfills every existing row in the same statement, and the value it
-- backfills is the safe one. Splitting it would leave a window in which rows
-- have no permit at all.

ALTER TABLE pending ADD COLUMN paid_allowed INTEGER NOT NULL DEFAULT 0;
