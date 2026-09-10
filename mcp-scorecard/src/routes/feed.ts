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
 */

import { type Env, json } from '../index.js';

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
    transcripts: `${origin}/grade/${r.audit_id}/transcripts`,
    self_graded: r.server_url.includes('scorecard.wanessalabs.com') ||
                 r.server_url.includes('mcp-scorecard.wanessalabs-042'),
    is_fixture: r.server_url.includes(FIXTURE_MARKER),
  }));

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
    candidates,
  });
}
