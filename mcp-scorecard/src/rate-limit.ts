/**
 * A quota on the one write path, because `POST /grade` is anonymous on purpose.
 *
 * Invariant 25 opens that endpoint deliberately: the site's demo queues a real
 * audit, so an anonymous call is accepted and marked `paid_allowed = 0`. The
 * launch audit of 2026-09-19 then asked the obvious next question and found no
 * answer anywhere in `src/`: nothing limited how often a stranger could use it.
 * One request carries up to 20 servers, each writing 3 to 5 rows, so a single
 * caller could write ~100 D1 rows per request for as long as they liked. The
 * exposure is not model spend, which `paid_allowed = 0` already forecloses. It
 * is D1 quota, unbounded queue growth, and being used as an amplifier against
 * somebody else's MCP server.
 *
 * ── Three decisions worth keeping ──────────────────────────────────────────
 *
 * **Cost is counted in ITEMS, not requests.** A limit of "10 requests an hour"
 * is 200 servers an hour through a 20-item batch, which is the thing being
 * limited wearing a disguise. Charging items makes the ceiling mean what it
 * says.
 *
 * **It fails CLOSED.** If the counter cannot be read or written, the request is
 * refused rather than waved through. The usual argument for failing open is
 * that a quota check should never take the service down, and it does not apply
 * here: the resource being protected IS the database the check just failed to
 * reach, so "write more anyway" is the one response that makes a bad situation
 * worse. Same direction as `mcp-gate.sh`, one layer in.
 *
 * **A presented credential gets its own, larger bucket.** Locking the operator
 * out of their own service during an incident is a real cost, and a caller who
 * holds `GRADE_TOKEN` is not the caller this protects against.
 *
 * Pure of platform APIs except D1, per invariant 1: no `node:` imports, and the
 * decision half below is a pure function so it can be tested without a Worker.
 */

/** Per identity, per window. Items, not requests. */
export const ANON_ITEMS_PER_WINDOW = 20;
/** A presented, accepted credential. */
export const AUTHED_ITEMS_PER_WINDOW = 200;
/** Everyone together, so one bad hour cannot spend the whole D1 quota. */
export const GLOBAL_ITEMS_PER_WINDOW = 600;
export const WINDOW_MS = 60 * 60 * 1000;

export interface RateDecision {
  allowed: boolean;
  /** Which ceiling refused, for the message. Null when allowed. */
  refusedBy: 'identity' | 'global' | 'unreadable' | null;
  /** Seconds until the window rolls. Always a positive integer when refused. */
  retryAfterSec: number;
  /** What the counter held BEFORE this request, for the report and the tests. */
  used: number;
  limit: number;
}

/**
 * Pure. Given what the counters hold and the clock, decide.
 *
 * Refusing at `used + cost > limit` rather than at `used >= limit` is the
 * difference between a 20-item batch being refused whole and being half
 * written: a partial batch is the shape that makes a caller retry the whole
 * thing, which costs more than saying no did.
 */
export function decide(
  { used, cost, limit, windowStart, now }:
  { used: number; cost: number; limit: number; windowStart: number; now: number },
  scope: 'identity' | 'global' = 'identity',
): RateDecision {
  const elapsed = now - windowStart;
  const retryAfterSec = Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000));
  if (used + cost > limit) {
    return { allowed: false, refusedBy: scope, retryAfterSec, used, limit };
  }
  return { allowed: true, refusedBy: null, retryAfterSec: 0, used, limit };
}

/** The window a timestamp belongs to. Fixed windows, not sliding: one row per key. */
export function windowStartFor(now: number): number {
  return now - (now % WINDOW_MS);
}

/**
 * The identity a quota is charged to.
 *
 * `CF-Connecting-IP` is set by Cloudflare and cannot be spoofed by the client
 * at the edge; `X-Forwarded-For` can be, so it is deliberately not consulted.
 * A request arriving without the header (local `wrangler dev`, a test) is
 * charged to one shared `unknown` bucket rather than being exempted, because an
 * exemption is a bypass and a shared bucket is merely strict.
 */
export function identityFor(req: Request, authed: boolean): string {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  return `${authed ? 'auth' : 'anon'}:${ip}`;
}

interface CounterRow { used: number; window_start: number }

/**
 * Read, decide, and charge. One row per key per window, upserted.
 *
 * The charge happens only on an allowed decision, so a refused caller does not
 * push their own window further out by retrying. That is a deliberate choice
 * against the "punish the retrier" design: it makes the ceiling a ceiling
 * rather than a moving target nobody can reason about.
 */
export async function enforceRateLimit(
  env: { DB: D1Database },
  req: Request,
  { cost, authed, now = Date.now() }: { cost: number; authed: boolean; now?: number },
): Promise<RateDecision> {
  const windowStart = windowStartFor(now);
  const identity = identityFor(req, authed);
  const limit = authed ? AUTHED_ITEMS_PER_WINDOW : ANON_ITEMS_PER_WINDOW;

  try {
    const keys = [
      { key: identity, limit, scope: 'identity' as const },
      { key: 'global', limit: GLOBAL_ITEMS_PER_WINDOW, scope: 'global' as const },
    ];

    const rows: Array<CounterRow | null> = [];
    for (const k of keys) {
      const row = await env.DB.prepare(
        'SELECT used, window_start FROM rate_limit WHERE key = ? AND window_start = ?',
      ).bind(k.key, windowStart).first<CounterRow>();
      rows.push(row ?? null);
    }

    for (let i = 0; i < keys.length; i++) {
      const d = decide(
        { used: rows[i]?.used ?? 0, cost, limit: keys[i].limit, windowStart, now },
        keys[i].scope,
      );
      if (!d.allowed) return d;
    }

    // Charged only once both ceilings allowed it. An older window for the same
    // key is replaced rather than accumulated, which is what makes the row
    // count bounded instead of growing forever.
    await env.DB.batch(keys.map((k) => env.DB.prepare(
      'INSERT INTO rate_limit (key, window_start, used) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET ' +
      'used = CASE WHEN rate_limit.window_start = excluded.window_start ' +
      'THEN rate_limit.used + excluded.used ELSE excluded.used END, ' +
      'window_start = excluded.window_start',
    ).bind(k.key, windowStart, cost)));

    return { allowed: true, refusedBy: null, retryAfterSec: 0,
             used: rows[0]?.used ?? 0, limit };
  } catch {
    // Fails closed. See the header note: the resource this protects is the
    // database that just failed, so admitting the write is the worse answer.
    return {
      allowed: false, refusedBy: 'unreadable',
      retryAfterSec: Math.max(1, Math.ceil((WINDOW_MS - (now - windowStart)) / 1000)),
      used: 0, limit,
    };
  }
}

/**
 * Proof that a request paid for its place in the queue.
 *
 * `enqueueAudit` REQUIRES one. That is invariant 19's reasoning pointed at
 * quota instead of at money: a required argument cannot be forgotten by a new
 * code path the way a check can, and this codebase has already been bitten
 * once by a second queue writer that never learned about the spend permit
 * (invariant 26). There are two callers today and neither can skip this.
 */
export interface Admission {
  readonly charged: number;
  readonly authed: boolean;
}

/**
 * The single entry point. Returns an Admission or the decision that refused.
 *
 * `cost` is the number of servers this request wants queued, so a 20-item
 * batch is charged 20 and refused whole rather than half written.
 */
export async function admitRequest(
  env: { DB: D1Database },
  req: Request,
  { cost, authed, now = Date.now() }: { cost: number; authed: boolean; now?: number },
): Promise<{ ok: true; admission: Admission } | { ok: false; decision: RateDecision }> {
  const decision = await enforceRateLimit(env, req, { cost, authed, now });
  if (!decision.allowed) return { ok: false, decision };
  return { ok: true, admission: { charged: cost, authed } };
}

/** One sentence a caller can act on, with no internals in it. */
export function refusalMessage(d: RateDecision): string {
  if (d.refusedBy === 'unreadable') {
    return 'this deployment could not verify its own rate limit, so nothing was queued. ' +
      'Nothing is wrong with your request. Retry shortly.';
  }
  if (d.refusedBy === 'global') {
    return 'this deployment is at its hourly ceiling across all callers, so nothing was queued. ' +
      `Retry in ${d.retryAfterSec}s.`;
  }
  return `rate limit reached: ${d.limit} servers per hour, so nothing was queued. ` +
    `Retry in ${d.retryAfterSec}s. Grading is free and anonymous on purpose, ` +
    'and the ceiling is what keeps it that way.';
}
