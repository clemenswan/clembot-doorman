/**
 * GET /feed - newly graded candidates, for a subscriber to poll.
 *
 * This is the shared half of the subscription. A candidate is graded ONCE and
 * every subscriber reads that grade for nothing, so the marginal cost of the
 * next subscriber is not another audit. The private half, deciding which of
 * these matter to a particular build, runs on the subscriber's own machine
 * against their own inventory and is never sent here.
 *
 * ONE ROW PER SERVER, not one per audit. A re-grade replaces its predecessor
 * rather than appearing beside it: a feed of events would show the same server
 * three times and a reader would have to work out which line was current.
 *
 * NOT CURATED. It contains this project's own servers and a deliberately
 * hostile test fixture, both of which are real graded rows. Filtering them out
 * here would be a hidden editorial decision inside something described as a
 * feed, and a consumer cannot see what was removed. `self_graded` and
 * `is_fixture` are stated per row so a client can filter and know it did.
 *
 * POPULARITY RIDES ALONG AND NEVER MIXES IN. Each row carries a `popularity`
 * block beside its grade, never inside its score. They answer different
 * questions: the grade is what happened when an agent drove the server, and
 * popularity is how many people installed it without asking that. A popular F
 * is the most useful row this feed can carry, and a composite that blended
 * them would be the one thing guaranteed to bury it.
 *
 * `sort=trending` REORDERS THE PAGE, IT DOES NOT SELECT IT. The page is still
 * chosen by `since` and `limit` against grading recency, so trending here
 * means "of the newest grades, which are moving", not "the fastest growing
 * servers in existence". Saying otherwise would imply a ranking over 13,677
 * registry entries from a sample of fifty.
 */

import { type Env, json } from '../index.js';
import {
  type Observation, type PopularityBlock, buildPopularity, serverKey,
} from '../popularity.js';

export const FEED_PAGE = 50;
export const FEED_MAX = 200;

/** Servers this deployment grades that are not candidates for anyone's build. */
export const FIXTURE_MARKER = 'planted-bad-mcp';

export interface FeedRow {
  server_url: string;
  server_name: string | null;
  audit_id: string;
  grade: string | null;
  score: number | null;
  static_pct: number | null;
  behavioral_pct: number | null;
  guidance_pct: number | null;
  hard_fail: string | null;
  model: string | null;
  mcpscore_version: string | null;
  completed_at: string | null;
}

/** How many of the three layers this audit actually measured. Null is NOT a layer. */
export function layersMeasured(r: {
  static_pct: number | null; behavioral_pct: number | null; guidance_pct: number | null;
}): number {
  return [r.static_pct, r.behavioral_pct, r.guidance_pct].filter((v) => v !== null && v !== undefined).length;
}

export interface FullerAudit {
  audit_id: string;
  grade: string | null;
  score: number | null;
  layers_measured: number;
  model: string | null;
  graded_at: string | null;
  transcripts: string;
}

/**
 * The audit that measured the MOST of this server, when it is not the newest.
 *
 * WHY THE NEWEST STILL WINS THE ROW. A re-grade reflects the server as it is
 * now, and `injection_sniff` runs without a model and can cap a grade at F on
 * its own. So a fresh static-only scan can carry real bad news, and promoting
 * an older, fuller, better-looking audit over it would suppress exactly the
 * finding that costs nothing to produce.
 *
 * WHY THE POINTER EXISTS ANYWAY. Until this shipped, a `--static-only` re-run
 * silently replaced a three-layer audit and the LETTER did not move: deepwiki
 * went from a complete A to a one-layer A and nothing on the wire said so.
 * Weights renormalising over the layers that ran is invariant 3 working
 * correctly, and it is precisely what makes the swap invisible, because an A
 * from 30 points of rubric and an A from 100 print identically.
 *
 * So the row reports `layers_measured`, and names the fuller audit when one
 * exists. It carries its own model and date because a grade is relative to
 * both, and comparing the two numbers directly is not valid.
 */
export async function fullerAuditsFor(
  rows: FeedRow[],
  origin: string,
  env: Env,
): Promise<Map<string, FullerAudit>> {
  const urls = [...new Set(rows.map((r) => r.server_url))];
  if (!urls.length) return new Map();

  // SQL ranks, TS decides. The ORDER BY needs a layer count to pick a best row
  // per server, but the COMPARISON that decides whether to publish a pointer
  // uses `layersMeasured` on both sides, from the returned columns. Counting
  // in two places is how the two counts drift, and the SQL one cannot be unit
  // tested. This is invariant 2 (never reimplement grade math in two halves)
  // applied to a much smaller number.
  const LAYERS =
    '((static_pct IS NOT NULL) + (behavioral_pct IS NOT NULL) + (guidance_pct IS NOT NULL))';
  const placeholders = urls.map(() => '?').join(',');

  const { results } = await env.DB.prepare(
    'SELECT server_url, id AS audit_id, grade, score, model, completed_at, ' +
    '       static_pct, behavioral_pct, guidance_pct FROM (' +
    '  SELECT server_url, id, grade, score, model, completed_at, ' +
    '         static_pct, behavioral_pct, guidance_pct, ' +
    '         ROW_NUMBER() OVER (PARTITION BY server_url ORDER BY ' + LAYERS + ' DESC, completed_at DESC) AS rn ' +
    '  FROM audits ' +
    "  WHERE status = 'complete' AND completed_at IS NOT NULL " +
    '    AND server_url IN (' + placeholders + ')' +
    ') WHERE rn = 1',
  ).bind(...urls).all<{
    server_url: string; audit_id: string; grade: string | null; score: number | null;
    model: string | null; completed_at: string | null;
    static_pct: number | null; behavioral_pct: number | null; guidance_pct: number | null;
  }>();

  const best = new Map<string, FullerAudit>();
  for (const b of results ?? []) {
    const current = rows.find((r) => r.server_url === b.server_url);
    if (!current) continue;
    const layers = layersMeasured(b);
    // STRICTLY more complete only. Equal coverage is a re-grade, not a fuller
    // measurement, and this also covers the case where the best row IS the
    // current one: same audit, same layers, so it never points at itself.
    if (layers <= layersMeasured(current)) continue;
    best.set(b.server_url, {
      audit_id: b.audit_id,
      grade: b.grade,
      score: b.score,
      layers_measured: layers,
      model: b.model,
      graded_at: b.completed_at,
      transcripts: `${origin}/grade/${b.audit_id}/transcripts`,
    });
  }
  return best;
}

/**
 * Every observation for the servers on this page, in one query.
 *
 * A missing `popularity` table is NOT an error here. The feed predates it, and
 * a deployment that has not run the migration should still serve grades rather
 * than 500 on a second axis nobody asked for. It degrades to no popularity at
 * all, which reads as null, which already means not measured.
 */
export async function popularityFor(
  rows: FeedRow[],
  env: Env,
): Promise<Map<string, PopularityBlock>> {
  const keys = [...new Set(rows.map((r) => serverKey(r.server_url)).filter((k): k is string => !!k))];
  if (!keys.length) return new Map();

  try {
    const placeholders = keys.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      'SELECT server_key, source, metric, value, observed_at FROM popularity ' +
      'WHERE server_key IN (' + placeholders + ') ORDER BY observed_at DESC',
    ).bind(...keys).all<Observation>();
    return buildPopularity(keys, results ?? []);
  } catch {
    return new Map();
  }
}

export async function handleFeed(url: URL, env: Env): Promise<Response> {
  const raw = Number(url.searchParams.get('limit') ?? FEED_PAGE);
  const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : FEED_PAGE, FEED_MAX);
  const since = url.searchParams.get('since');
  const origin = url.origin;

  // The newest COMPLETE audit per server. `completed_at` orders the feed
  // rather than `created_at`, because a subscriber polling for what is new
  // cares when the grade landed, not when the work was queued: an audit
  // queued on Monday and finished on Friday is Friday's news.
  const base =
    'SELECT a.server_url, a.server_name, a.id AS audit_id, a.grade, a.score, ' +
    '       a.static_pct, a.behavioral_pct, a.guidance_pct, a.hard_fail, ' +
    '       a.model, a.mcpscore_version, a.completed_at ' +
    'FROM audits a ' +
    'JOIN (SELECT server_url, MAX(completed_at) AS newest FROM audits ' +
    "      WHERE status = 'complete' AND completed_at IS NOT NULL " +
    '      GROUP BY server_url) newest ' +
    '  ON a.server_url = newest.server_url AND a.completed_at = newest.newest ' +
    "WHERE a.status = 'complete' ";

  const stmt = since
    ? env.DB.prepare(base + 'AND a.completed_at > ? ORDER BY a.completed_at DESC LIMIT ?')
        .bind(since, limit)
    : env.DB.prepare(base + 'ORDER BY a.completed_at DESC LIMIT ?').bind(limit);

  const { results } = await stmt.all<FeedRow>();
  const rows = results ?? [];

  const pop = await popularityFor(rows, env);
  // A deployment mid-migration, or one whose SQLite lacks window functions,
  // must still serve grades. No pointer is a weaker feed, not a broken one.
  const fuller = await fullerAuditsFor(rows, origin, env).catch(() => new Map<string, FullerAudit>());

  const candidates = rows.map((r) => ({
    server_url: r.server_url,
    server_name: r.server_name,
    audit_id: r.audit_id,
    grade: r.grade,
    score: r.score,
    // Explicit nulls, never zeros. An unmeasured layer and a layer that scored
    // nothing are different claims and a subscriber must be able to tell them
    // apart before deciding anything.
    layers: {
      static_pct: r.static_pct,
      behavioral_pct: r.behavioral_pct,
      guidance_pct: r.guidance_pct,
    },
    hard_fail: r.hard_fail,
    model: r.model,
    mcpscore_version: r.mcpscore_version,
    graded_at: r.completed_at,
    // How much of the rubric this row rests on. An A from one layer and an A
    // from three print identically without it, which is what let a cheap
    // re-grade replace a complete audit unnoticed.
    layers_measured: layersMeasured(r),
    // Present only when an EARLIER audit measured strictly more of this
    // server. Null is the normal case and means this row is the fullest there
    // is, not that no history exists.
    more_complete_audit: fuller.get(r.server_url) ?? null,
    transcripts: `${origin}/grade/${r.audit_id}/transcripts`,
    self_graded: r.server_url.includes('scorecard.wanessalabs.com') ||
                 r.server_url.includes('mcp-scorecard.wanessalabs-042'),
    is_fixture: r.server_url.includes(FIXTURE_MARKER),
    // Null here means no source has ever been read for this server, which is
    // the normal state for one nobody has mapped yet. It is not a claim that
    // the server is unpopular.
    popularity: pop.get(serverKey(r.server_url) ?? '') ?? null,
  }));

  // Movement first, and rows with NO trend keep their grading order at the
  // back rather than being scored zero. A server observed once has not been
  // measured as flat, and sorting it beside a genuine 0% would be the same
  // mistake as scoring an unrun probe layer.
  if (url.searchParams.get('sort') === 'trending') {
    candidates.sort((a, b) => {
      const at = a.popularity?.trend ?? null;
      const bt = b.popularity?.trend ?? null;
      if (at === null && bt === null) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return bt - at;
    });
  }

  // The cursor is the newest row's timestamp, so a client polls forward without
  // keeping a list of what it has seen. Null on an empty page means "nothing
  // new, keep the cursor you had" rather than "start again".
  const nextSince = candidates.length ? candidates[0].graded_at : null;

  return json({
    generated_at: new Date().toISOString(),
    count: candidates.length,
    next_since: nextSince,
    price_usdc: 0,
    note:
      'One row per server, newest grade only. Reading this costs nothing. ' +
      'Every grade here is relative to the model named on it, and any layer ' +
      'reported null was NOT measured rather than scored zero. Rows are not ' +
      'filtered: `self_graded` and `is_fixture` mark the ones that are not ' +
      'candidates for your build.',
    completeness_note:
      'The NEWEST grade per server wins the row, including when it measured ' +
      'less than an earlier one: a re-grade reflects the server as it is now, ' +
      'and the scan-only injection probe needs no model and can cap a grade at ' +
      'F by itself, so a cheap fresh audit can carry real bad news. ' +
      '`layers_measured` says how many of the three layers this row rests on, ' +
      'and `more_complete_audit` names an earlier audit that measured strictly ' +
      'more, with its own model and date. Do not compare the two scores ' +
      'directly: weights renormalise over the layers that ran, and a grade is ' +
      'relative to the model that produced it.',
    popularity_note:
      'Popularity is a SECOND AXIS and is never part of the score. Counts from ' +
      'different sources are ranked within each source and combined by median ' +
      'percentile, never summed: they count different populations in different ' +
      'units. `percentile` is measured against the servers on this page only, ' +
      'not against any registry. `sources_measured` says how many sources ' +
      'backed it, and a trend needs two readings at least 12 hours apart, so a ' +
      'newly tracked server reports null rather than zero growth. Install ' +
      'counts from doorman itself are deliberately not a source: that would ' +
      'need telemetry, and your inventory never leaves your machine.',
    candidates,
  });
}
