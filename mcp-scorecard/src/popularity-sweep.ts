/**
 * The sweep that produces popularity observations. Network lives here; the
 * arithmetic lives in popularity.ts and is testable without a socket.
 *
 * RUNS ON A CRON IN THE WORKER, not on the laptop runner. The audit runner has
 * to be a laptop because mcpscore needs Python and native deps. Reading three
 * public JSON endpoints does not, and putting it here means the feed's
 * popularity is fresh whether or not anyone is at a keyboard.
 *
 * A SOURCE THAT FAILS WRITES NOTHING. GitHub rate-limits unauthenticated calls
 * to 60/hour per IP, and Workers egress from shared Cloudflare addresses, so
 * 403 is an expected outcome rather than an incident. The row is then absent,
 * the feed reports that source as null, and `sources_measured` drops by one.
 * What must never happen is a failed fetch being recorded as a zero: that
 * would read as "nobody uses this" and would rank a popular server last.
 * Set a GITHUB_TOKEN secret to raise the limit to 5,000/hour.
 *
 * IT ONLY ASKS ABOUT WHAT IT WAS TOLD TO ASK ABOUT. `popularity_subject` maps
 * a graded server to its npm package or GitHub repo, and it starts empty.
 * Guessing that a server called "github" is the npm package "github" would
 * measure a stranger's package and publish it as this server's popularity.
 */

import type { Env } from './index.js';
import { SOURCES, MAX_OBSERVATIONS_PER_SERIES } from './popularity.js';

export const UA = 'clembot-doorman/0.1 (+https://clembot-doorman.wanessalabs.com)';

export interface SubjectRow {
  server_key: string;
  source: string;
  subject: string;
}

export interface SweepResult {
  observed: number;
  /** Per source, how many lookups failed. Reported, never silently dropped. */
  failed: Record<string, number>;
  pruned: number;
}

/** Weekly downloads. No auth, no key, generous limits. */
export async function fetchNpm(pkg: string, f: typeof fetch = fetch): Promise<number | null> {
  const url = 'https://api.npmjs.org/downloads/point/last-week/' + encodeURIComponent(pkg);
  const res = await f(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return null;
  const body = await res.json() as { downloads?: number };
  return typeof body.downloads === 'number' ? body.downloads : null;
}

/** Stars. Rate-limited hard without a token; null on 403 is the normal path. */
export async function fetchGithub(
  repo: string,
  token: string | undefined,
  f: typeof fetch = fetch,
): Promise<number | null> {
  const headers: Record<string, string> = {
    'user-agent': UA,
    accept: 'application/vnd.github+json',
  };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await f('https://api.github.com/repos/' + repo, { headers });
  if (!res.ok) return null;
  const body = await res.json() as { stargazers_count?: number };
  return typeof body.stargazers_count === 'number' ? body.stargazers_count : null;
}

/**
 * Smithery's own install counter, the closest thing to an installed base.
 *
 * READS THE LIST ENDPOINT, NOT THE DETAIL ONE, and that is not a style choice.
 * Verified against the live registry on 2026-09-11: the detail record for
 * `subwayinfo` returns `qualifiedName, displayName, description, iconUrl,
 * remote, deploymentUrl, connections, security, tools, resources, prompts` and
 * carries NO useCount and NO homepage. Both live only on the list row. An
 * earlier version of this function read the detail endpoint and would have
 * returned null for every Smithery server forever, which the feed would have
 * reported as "source not measured" rather than as a broken fetch: correct
 * behaviour on bad input, and invisible.
 */
export async function fetchSmithery(id: string, f: typeof fetch = fetch): Promise<number | null> {
  const res = await f(
    'https://registry.smithery.ai/servers?q=' + encodeURIComponent(id) + '&pageSize=20',
    { headers: { 'user-agent': UA, accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const body = await res.json() as { servers?: Array<{ qualifiedName?: string; useCount?: number }> };
  // Match the exact qualifiedName. A search for "exa" returns many servers and
  // taking the first would count a different product's installs under this one.
  const row = (body.servers ?? []).find((s) => s.qualifiedName === id);
  return typeof row?.useCount === 'number' ? row.useCount : null;
}

export async function readOne(
  row: SubjectRow,
  env: Env,
  f: typeof fetch = fetch,
): Promise<number | null> {
  try {
    if (row.source === 'npm') return await fetchNpm(row.subject, f);
    if (row.source === 'github') return await fetchGithub(row.subject, env.GITHUB_TOKEN, f);
    if (row.source === 'smithery') return await fetchSmithery(row.subject, f);
  } catch {
    // A thrown fetch is the same as a failed one: no reading, no row.
    return null;
  }
  return null;
}

/**
 * One pass over every mapped subject.
 *
 * Sequential on purpose. This is a daily job over tens of rows, and firing
 * them in parallel is the fastest way to get every source to rate-limit at
 * once, which would turn a slow sweep into a sweep that measures nothing.
 */
export async function sweepPopularity(env: Env, f: typeof fetch = fetch): Promise<SweepResult> {
  const { results } = await env.DB
    .prepare('SELECT server_key, source, subject FROM popularity_subject')
    .all<SubjectRow>();
  const subjects = results ?? [];

  const now = new Date().toISOString();
  const failed: Record<string, number> = {};
  const writes: D1PreparedStatement[] = [];

  for (const row of subjects) {
    const metric = SOURCES[row.source as keyof typeof SOURCES]?.metric;
    if (!metric) continue;
    const value = await readOne(row, env, f);
    if (value === null) {
      failed[row.source] = (failed[row.source] ?? 0) + 1;
      continue;
    }
    writes.push(
      env.DB.prepare(
        'INSERT OR REPLACE INTO popularity (server_key, source, metric, value, subject, observed_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(row.server_key, row.source, metric, value, row.subject, now),
    );
  }

  if (writes.length) await env.DB.batch(writes);

  // Bound the series. Thirty readings per (server, source) is a month of daily
  // history, which is plenty for a trend and small enough to fetch whole.
  const prune = await env.DB.prepare(
    'DELETE FROM popularity WHERE rowid IN (' +
    '  SELECT rowid FROM (' +
    '    SELECT rowid, ROW_NUMBER() OVER (PARTITION BY server_key, source ORDER BY observed_at DESC) AS rn' +
    '    FROM popularity' +
    '  ) WHERE rn > ?' +
    ')',
  ).bind(MAX_OBSERVATIONS_PER_SERIES).run();

  return {
    observed: writes.length,
    failed,
    pruned: prune.meta?.changes ?? 0,
  };
}
