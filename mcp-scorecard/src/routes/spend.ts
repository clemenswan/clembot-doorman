/**
 * The inbound spend permit.
 *
 * `budget.mjs` refuses to let the doorman spend money on the way OUT without a
 * permit. This is the same rule pointed the other way: nothing arriving from
 * outside may cause this service to spend model tokens unless it presented a
 * credential saying it may.
 *
 * The hole it closes is concrete. `POST /grade` is open, deliberately, because
 * the demo on the site lets a visitor type an MCP url and queue a real audit.
 * That costs nothing today only because no ANTHROPIC_API_KEY has ever been
 * supplied. The moment one is, every anonymous visitor can spend it.
 *
 * ## Why this is a downgrade and not a wall
 *
 * A wall would close the hole by deleting the demo, and the demo is the best
 * thing on the page. So an anonymous request is still accepted and still
 * queued: it is marked as static-only, and the runner may never spend a model
 * token on it. The free layer is genuinely free, so an anonymous caller gets a
 * real grade of the part that costs nothing, and no part that costs something.
 *
 *   anonymous       -> 202, queued, paid_allowed = 0, static layer only
 *   valid token     -> 202, queued, paid_allowed = 1, full behavioural run
 *   wrong token     -> 401, nothing queued
 *
 * **A missing credential is a choice. A wrong one is a mistake.** Silently
 * downgrading a caller who believes they are authenticated would hide a
 * misconfigured runner until the bill arrived, so that case is loud.
 *
 * ## What this must never gate
 *
 * The routes it applies to are `PAID_ROUTES`, imported rather than restated.
 * One list, one definition. A second copy of "what can cost money" would drift
 * from the first, and the half that drifted would be the half nobody read.
 *
 * `NEVER_PAID` carries the tape. A grade is an accusation and the evidence for
 * one cannot sit behind the accuser's token any more than behind the accuser's
 * paywall. `spend-gate.test.ts` asserts every route on that list answers with
 * no Authorization header at all.
 */

import { PAID_ROUTES } from './payment.js';
import { timingSafeEqual } from './runner.js';

export interface SpendEnv {
  /**
   * Shared secret that authorises a paid audit. Set with `wrangler secret put`,
   * never in wrangler.toml.
   *
   * Unset is a supported state: the service then runs static-only for everyone,
   * which is exactly what it does today and costs nothing. It is NOT a state in
   * which a presented token is accepted.
   */
  GRADE_TOKEN?: string;
}

export type SpendVerdict = 'authorised' | 'anonymous' | 'bad-token';

/** True when this method+path is one that can cost money. */
export function isSpendGated(method: string, path: string): boolean {
  return PAID_ROUTES.some((r) => r.method === method && r.path === path);
}

/**
 * Read the caller's spend permit off the request.
 *
 * Note the third branch: a token presented against a deployment with no
 * GRADE_TOKEN configured is `bad-token`, not `authorised` and not `anonymous`.
 * Treating it as authorised would make an unconfigured service the most
 * permissive one, which is the failure this whole file exists to refuse.
 */
export function spendPermit(req: Request, env: SpendEnv): SpendVerdict {
  const header = req.headers.get('authorization');
  if (!header) return 'anonymous';

  // `\s+` not `\s*`, deliberately. HTTP trims header values, so a bare
  // `Authorization: Bearer` arrives as `Bearer` with nothing after it. Keeping
  // the prefix required means that string falls through to the comparison and
  // is refused, which is what we want: a client sending it was trying to
  // authenticate, and reading that as anonymous is the silent downgrade this
  // file exists to avoid. Only a genuinely empty value takes the demo path.
  const presented = header.replace(/^Bearer\s+/i, '').trim();
  if (!presented) return 'anonymous';
  if (!env.GRADE_TOKEN) return 'bad-token';
  return timingSafeEqual(presented, env.GRADE_TOKEN) ? 'authorised' : 'bad-token';
}

/** 1 when the runner may spend a model token on this audit, 0 when it may not. */
export function paidAllowed(verdict: SpendVerdict): 0 | 1 {
  return verdict === 'authorised' ? 1 : 0;
}
