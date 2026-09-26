/**
 * Community signal. What an install may contribute back, and nothing else.
 *
 * Brief: `community-signal.md`. The short version is that doorman already has
 * a community READ path (`GET /feed` plus `doorman watch`, matching locally
 * against an inventory that never leaves the machine) and had no write path at
 * all, so the service knew what it had graded and knew nothing about what
 * anyone wanted and could not find.
 *
 * TWO SIGNALS, BOTH COUNTS OVER A CLOSED VOCABULARY. A capability the client's
 * own taxonomy named, and a server name the gate refused. No counts of how
 * often, no urls, no prose, no inventory, no identity.
 *
 * WHY THE VOCABULARY LIVES HERE AND NOT IN BOTH HALVES. The client holds the
 * same twelve ids in `doorman/src/needs.mjs`, and shipping the list twice and
 * trusting the copies to agree is the shape invariant 2 already refuses for
 * grade math. The reasoning carries over unchanged: two implementations drift,
 * and a drifted vocabulary silently discards valid contributions. One
 * authority validates, and every dropped term is NAMED in the reply, so drift
 * surfaces as something the contributor can read instead of as silence.
 *
 * WHY THERE IS NO FREE-TEXT FIELD, IN EITHER DIRECTION, EVER. `needs.mjs`
 * promises in its own header that the prompts never leave the machine, and
 * invariant 28 is why that promise matters: 1548 of 1656 `user` records in a
 * real transcript directory are tool results, hook attachments and expanded
 * slash-command bodies. A field here that accepted prose would ship a
 * contributor's own files to a server, under a feature described as telling us
 * what they were missing. So this carries the taxonomy id that matched and
 * never the sentence that matched it.
 *
 * A SERVER NAME IS DELIBERATELY DIFFERENT. It is what the gate can see and all
 * it can see, since a refusal is a `mcp__<server>__<tool>` call and nothing
 * more. It is already published by whoever wrote the MCP config. And it is the
 * only readout anyone has of what people are trying to install that nobody has
 * graded.
 *
 * NOTHING HERE MAY TOUCH A GRADE. A demand count is not evidence about
 * quality. `feed.ts` already reasons this way about popularity: the grade is
 * what happened when an agent drove the server, popularity is how many people
 * installed it without asking that, and a popular F is the most useful row the
 * feed can carry. Demand is the third thing on that shelf. Keeping it there is
 * what keeps the PRD's non-goal true (there is still no central verdict; the
 * allowlist stays local) and it is what bounds the damage from gaming, since
 * an inflated count can only reorder a queue of what to grade next.
 */

/**
 * The twelve capability ids, mirroring `NEEDS` in `doorman/src/needs.mjs`.
 *
 * Adding one here before the client knows about it is harmless: nothing will
 * ever send it. Removing one is not, because contributions carrying it start
 * being dropped, which is why this list only ever grows.
 */
export const VOCABULARY = [
  'docs-lookup',
  'web-search',
  'browser-automation',
  'code-host',
  'database',
  'observability',
  'cloud-deploy',
  'design-assets',
  'payments',
  'knowledge-base',
  'comms',
  'data-files',
] as const;

const VOCAB = new Set<string>(VOCABULARY);

/**
 * How many terms one request may carry, per kind.
 *
 * The client has twelve capabilities and a build with more than twenty blocked
 * server names has a configuration problem rather than a contribution. The cap
 * exists so the work this endpoint does is bounded by the payload rather than
 * by the sender's patience.
 */
export const MAX_TERMS_PER_REQUEST = 20;

/**
 * A server name as the gate sees it. Same alphabet Claude Code allows in an
 * `mcp__<server>__<tool>` tool name, which is what makes this safe: there is
 * no room in it for a url, a path, a newline or a sentence.
 */
const NAME_SHAPE = /^[A-Za-z0-9_-]+$/;
const NAME_MAX = 64;

export interface Dropped {
  value: string;
  why: string;
}

export interface Classified {
  gaps: string[];
  blocked: string[];
  dropped: Dropped[];
  /** True when the caller sent more than the cap and the tail was discarded. */
  truncated: boolean;
}

/** Unique, order-preserving, non-strings removed but remembered. */
function normalise(input: unknown): { values: string[]; nonStrings: unknown[] } {
  if (!Array.isArray(input)) return { values: [], nonStrings: [] };
  const seen = new Set<string>();
  const values: string[] = [];
  const nonStrings: unknown[] = [];
  for (const v of input) {
    if (typeof v !== 'string') { nonStrings.push(v); continue; }
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    values.push(t);
  }
  return { values, nonStrings };
}

/**
 * Decide what may be counted. Pure, so the refusals are testable without a
 * database, a request, or a deployment.
 *
 * An entirely unknown payload comes back with everything dropped rather than
 * as an error. The contributor is running a newer client than this deployment
 * knows about, and refusing the whole request would not tell them WHICH term
 * was the problem.
 */
export function classify(body: { gaps?: unknown; blocked?: unknown }): Classified {
  const dropped: Dropped[] = [];

  const g = normalise(body.gaps);
  const b = normalise(body.blocked);
  for (const v of [...g.nonStrings, ...b.nonStrings]) {
    dropped.push({ value: String(v), why: 'not a string' });
  }

  const truncated = g.values.length > MAX_TERMS_PER_REQUEST
    || b.values.length > MAX_TERMS_PER_REQUEST;

  const gaps: string[] = [];
  for (const term of g.values.slice(0, MAX_TERMS_PER_REQUEST)) {
    if (VOCAB.has(term)) gaps.push(term);
    else dropped.push({ value: term, why: 'not in the vocabulary' });
  }

  const blocked: string[] = [];
  for (const name of b.values.slice(0, MAX_TERMS_PER_REQUEST)) {
    if (name.length > NAME_MAX) {
      dropped.push({ value: name, why: `too long for a server name, max ${NAME_MAX}` });
    } else if (!NAME_SHAPE.test(name)) {
      dropped.push({ value: name, why: 'not shaped like a server name the gate could see' });
    } else {
      blocked.push(name);
    }
  }

  return { gaps, blocked, dropped, truncated };
}

/**
 * The bucket a contribution lands in. A UTC date and nothing finer, because
 * finer than a day is a timing channel over a small population and nothing
 * downstream needs an hour.
 */
export function dayFor(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface Counted {
  gaps: number;
  blocked: number;
}

/**
 * Record the accepted terms. One upsert per term, binding kind, term and day
 * and nothing else: the table has no column that could hold anything more, and
 * that is the point rather than an oversight.
 */
export async function recordSignal(
  env: { DB: D1Database },
  accepted: { gaps: string[]; blocked: string[] },
  now: number,
): Promise<Counted> {
  const day = dayFor(now);
  const sql = 'INSERT INTO signal_count (kind, term, day, n) VALUES (?, ?, ?, 1) '
    + 'ON CONFLICT(kind, term, day) DO UPDATE SET n = n + 1';

  const writes = [
    ...accepted.gaps.map((t) => env.DB.prepare(sql).bind('gap', t, day)),
    ...accepted.blocked.map((t) => env.DB.prepare(sql).bind('blocked', t, day)),
  ];
  if (writes.length) await env.DB.batch(writes);

  return { gaps: accepted.gaps.length, blocked: accepted.blocked.length };
}

export interface SignalRow {
  term: string;
  reports: number;
  first_seen: string;
}

export interface SignalsView {
  vocabulary: string[];
  gaps: SignalRow[];
  blocked: SignalRow[];
  note: string;
}

/**
 * The public aggregate.
 *
 * `reports` is deliberately not called `builds`. Nothing here knows who is
 * asking, so nothing here can count builds, and a field named `builds` would
 * be a number this service cannot support. One build reporting the same gap on
 * thirty days is thirty reports.
 *
 * A read failure THROWS rather than returning empty lists. Invariant 3: zero
 * reports and a broken query look identical in a list, and one of them means
 * nobody needs anything.
 */
export async function readSignals(env: { DB: D1Database }): Promise<SignalsView> {
  const { results } = await env.DB.prepare(
    'SELECT kind, term, SUM(n) AS reports, MIN(day) AS first_seen '
    + 'FROM signal_count GROUP BY kind, term ORDER BY reports DESC, term ASC',
  ).all<{ kind: string; term: string; reports: number; first_seen: string }>();

  const pick = (kind: string): SignalRow[] => (results ?? [])
    .filter((r) => r.kind === kind)
    .map((r) => ({ term: r.term, reports: Number(r.reports), first_seen: r.first_seen }));

  return {
    vocabulary: [...VOCABULARY],
    gaps: pick('gap'),
    blocked: pick('blocked'),
    note: 'Reports, not installs. One build may report the same gap on many days, '
      + 'and nothing here knows who is asking. These counts are demand and never '
      + 'evidence about quality: no grade, band or weight reads them.',
  };
}
