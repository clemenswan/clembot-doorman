/**
 * Popularity and trend, as a SECOND AXIS beside the grade.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: popularity never touches the
 * score. The grade is 30 static / 50 behavioural / 20 guidance and every point
 * of it comes from driving the server. How many people install a thing is not
 * evidence that it works, and a widely-installed server that fails a probe is
 * the most valuable row in the feed. Blending the two would hide precisely the
 * finding the product exists to surface.
 *
 * THREE SOURCES, NEVER SUMMED. 87,579 Smithery uses, 4,200 weekly npm
 * downloads and 1,100 GitHub stars are three different units counting three
 * different populations. Adding them produces a number with no meaning that
 * still sorts confidently. So each source is ranked WITHIN ITSELF, turned into
 * a percentile, and the composite is the median of the percentiles that exist.
 * `sources_measured` rides along, because a server ranked on one source and a
 * server ranked on three are not equally well known and the composite alone
 * cannot say so.
 *
 * THE FOURTH SOURCE IS REFUSED ON PURPOSE. Doorman knows exactly which servers
 * its subscribers have installed, which would be the best popularity signal
 * available to anyone. Collecting it needs telemetry, and `watch` and `needs`
 * are built on the promise that your inventory never leaves your machine.
 * Trading that for a better number would sell the only guarantee that makes
 * the private half of the product worth running.
 *
 * NULL DISCIPLINE, which bit this codebase twice in one day. A source with no
 * reading writes NO ROW, and reads back as null. Null means NOT MEASURED. It
 * never becomes 0, it never becomes "flat", and it never quietly improves a
 * rank by leaving the denominator.
 */

/** One reading, as stored. */
export interface Observation {
  server_key: string;
  source: string;
  metric: string;
  value: number;
  observed_at: string;
}

export interface Trend {
  /** Most recent reading. */
  value: number;
  /** The reading it is compared against. */
  previous: number;
  /** Fractional change, e.g. 0.12 for +12%. Null when it cannot be computed. */
  delta: number | null;
  /** Days between the two readings, so a reader can judge the window. */
  window_days: number;
  observed_at: string;
}

export const SOURCES = {
  smithery: { metric: 'use_count' },
  npm: { metric: 'weekly_downloads' },
  github: { metric: 'stars' },
} as const;

export type SourceName = keyof typeof SOURCES;

/**
 * Two readings twelve minutes apart are not a trend, they are noise with a
 * timestamp. The sweep runs daily, so anything under half a day means the
 * second reading landed from a retry or a manual run.
 */
export const MIN_TREND_HOURS = 12;

/** Keep the series bounded. Thirty daily readings is a month of history. */
export const MAX_OBSERVATIONS_PER_SERIES = 30;

/**
 * Normalise a server url for comparison. Host plus path, lowercased, trailing
 * slash dropped.
 *
 * MUST match `serverKey` in doorman/cli/watch.mjs. Host alone is too coarse:
 * openzeppelin publishes four servers under one host, and keying on the host
 * would credit all four with one server's popularity.
 */
export function serverKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    const path = u.pathname.replace(/\/+$/, '');
    return (u.hostname.toLowerCase() + path.toLowerCase()) || u.hostname.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase().replace(/\/+$/, '') || null;
  }
}

/**
 * Trend from a series of readings for ONE server and ONE source.
 *
 * Returns null rather than a zero trend when there is only one reading. A
 * first observation is not a flat line: nothing has been compared yet, and
 * rendering it as 0% growth would sort a brand new entry below a genuinely
 * declining one.
 */
export function trendFor(series: Observation[]): Trend | null {
  if (!series || !series.length) return null;
  const sorted = [...series].sort((a, b) => (a.observed_at < b.observed_at ? 1 : -1));
  const latest = sorted[0];
  if (sorted.length < 2) return null;

  // Walk back to the first reading far enough away to mean something.
  const latestMs = Date.parse(latest.observed_at);
  const HOUR_MS = 3600000;
  const prior = sorted.slice(1).find(
    (o) => (latestMs - Date.parse(o.observed_at)) / HOUR_MS >= MIN_TREND_HOURS,
  );
  if (!prior) return null;

  const DAY_MS = 86400000;
  const windowDays = (latestMs - Date.parse(prior.observed_at)) / DAY_MS;
  // Growth from a zero base is undefined, not infinite and not 100%. A server
  // that went from 0 to 5 downloads gets a value and no delta.
  const delta = prior.value > 0 ? (latest.value - prior.value) / prior.value : null;

  return {
    value: latest.value,
    previous: prior.value,
    delta,
    window_days: Math.round(windowDays * 10) / 10,
    observed_at: latest.observed_at,
  };
}

/**
 * Percentile of each server within ONE source. 1 is the most popular.
 *
 * A source measuring fewer than two servers contributes NOTHING. Being top of
 * a field of one is not a ranking, and scoring it 1.0 would let a single
 * obscure npm package outrank a server ranked against fifty peers.
 */
export function percentileWithinSource(values: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (values.size < 2) return out;
  const sorted = [...values.entries()].sort((a, b) => a[1] - b[1]);
  const n = sorted.length;
  sorted.forEach(([key], i) => out.set(key, i / (n - 1)));
  return out;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface SourceReading {
  metric: string;
  value: number;
  delta: number | null;
  window_days: number | null;
  observed_at: string;
}

export interface PopularityBlock {
  /** Per source: the latest value and its trend. A source absent was NOT measured. */
  sources: Record<string, SourceReading>;
  /** Median percentile across the sources that ranked it. Null if none did. */
  percentile: number | null;
  /** How many sources backed that percentile. A 1 and a 3 are not equivalent. */
  sources_measured: number;
  /** Median trend across sources that HAVE a trend. Null if none do. */
  trend: number | null;
}

/**
 * Build the popularity block for every server in one page of the feed.
 *
 * Percentiles are computed over the servers PRESENT IN THIS CALL. That is a
 * real limitation and it is stated on the wire: a percentile against 26 graded
 * servers is not a percentile against the registry's 13,677.
 */
export function buildPopularity(
  keys: string[],
  observations: Observation[],
): Map<string, PopularityBlock> {
  const bySeries = new Map<string, Observation[]>();
  for (const o of observations) {
    const id = o.server_key + ' ' + o.source;
    const arr = bySeries.get(id);
    if (arr) arr.push(o);
    else bySeries.set(id, [o]);
  }

  // Latest value per (server, source), and the trend where one exists.
  type Latest = { value: number; metric: string; observed_at: string; trend: Trend | null };
  const latest = new Map<string, Map<string, Latest>>();
  for (const [id, series] of bySeries) {
    const sep = id.lastIndexOf(' ');
    const key = id.slice(0, sep);
    const source = id.slice(sep + 1);
    const sorted = [...series].sort((a, b) => (a.observed_at < b.observed_at ? 1 : -1));
    const head = sorted[0];
    if (!latest.has(key)) latest.set(key, new Map());
    const bucket = latest.get(key);
    if (bucket) {
      bucket.set(source, {
        value: head.value,
        metric: head.metric,
        observed_at: head.observed_at,
        trend: trendFor(sorted),
      });
    }
  }

  // Rank each source independently.
  const ranks = new Map<string, Map<string, number>>();
  for (const source of Object.keys(SOURCES)) {
    const vals = new Map<string, number>();
    for (const key of keys) {
      const v = latest.get(key)?.get(source);
      if (v) vals.set(key, v.value);
    }
    ranks.set(source, percentileWithinSource(vals));
  }

  const out = new Map<string, PopularityBlock>();
  for (const key of keys) {
    const perSource = latest.get(key);
    const sources: Record<string, SourceReading> = {};
    const pcts: number[] = [];
    const trends: number[] = [];

    for (const source of Object.keys(SOURCES)) {
      const v = perSource?.get(source);
      if (!v) continue;
      sources[source] = {
        metric: v.metric,
        value: v.value,
        delta: v.trend?.delta ?? null,
        window_days: v.trend?.window_days ?? null,
        observed_at: v.observed_at,
      };
      const p = ranks.get(source)?.get(key);
      if (p !== undefined) pcts.push(p);
      if (v.trend?.delta != null) trends.push(v.trend.delta);
    }

    out.set(key, {
      sources,
      percentile: median(pcts),
      sources_measured: pcts.length,
      trend: median(trends),
    });
  }
  return out;
}
