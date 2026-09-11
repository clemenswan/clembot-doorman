-- Popularity and trend. A SECOND AXIS, deliberately not part of the grade.
--
-- WHY IT IS SEPARATE. The grade answers "does this work when an agent drives
-- it". Popularity answers "are other people using it". Those are different
-- questions and blending them would let a widely-installed server launder its
-- way past a probe failure. A popular F is the single most useful row this
-- feed can publish, and folding these together is exactly what would hide it.
--
-- WHY OBSERVATIONS, NOT A COUNTER. Trending is a DELTA, and a delta needs two
-- readings. Storing only the current value makes the first reading look like a
-- trend of zero, which is a measurement nobody took. Rows are append-only for
-- the same reason audits are.

-- One reading of one metric, from one source, at one time.
CREATE TABLE IF NOT EXISTS popularity (
  server_key  TEXT NOT NULL,   -- normalised host+path, same shape watch.mjs uses
  source      TEXT NOT NULL,   -- smithery|npm|github
  metric      TEXT NOT NULL,   -- use_count|weekly_downloads|stars
  value       REAL NOT NULL,   -- never NULL: an unmeasured source writes NO ROW
  subject     TEXT,            -- the source-side id actually read, for audit
  observed_at TEXT NOT NULL,
  PRIMARY KEY (server_key, source, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_pop_recent ON popularity(server_key, source, observed_at DESC);

-- What to ask each source about. A server with no row here is NOT MEASURED by
-- that source, which is a different claim from being unpopular on it, and the
-- feed reports it as null rather than zero.
--
-- Deliberately EMPTY at migration time. Seeding it by guessing that a server
-- named "github" is the npm package "github" would manufacture numbers about
-- the wrong package, and a wrong popularity figure is worse than none because
-- it looks measured. Filled by `doorman popularity link`, or by the sweep when
-- a registry states the mapping itself.
CREATE TABLE IF NOT EXISTS popularity_subject (
  server_key TEXT NOT NULL,
  source     TEXT NOT NULL,
  subject    TEXT NOT NULL,   -- npm package name, "owner/repo", smithery id
  added_at   TEXT NOT NULL,
  PRIMARY KEY (server_key, source)
);
