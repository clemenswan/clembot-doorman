/**
 * POST /signal - what an install needed and could not find.
 * GET  /signals - the public aggregate.
 *
 * Open and anonymous, like `POST /grade` and for the same reason given in
 * invariant 25: the thing being protected is not the contributor's identity,
 * it is the database. So this goes through the same `admitRequest` limiter,
 * charged in items, failing closed.
 *
 * WHY AN UNKNOWN TERM IS NOT AN ERROR. A contributor running a newer client
 * than this deployment knows about would get a 400 naming nothing useful, and
 * would have no way to tell a broken request from a vocabulary that had moved.
 * Every dropped value comes back with the reason it was dropped, and the rest
 * is still counted.
 *
 * WHY THE READ IS FREE. Every other read here is free. A demand list visible
 * only to contributors would make the first useful thing this produces
 * conditional on giving something up, which is the opposite of the trade the
 * feed already makes.
 */

import { type Env, json, err } from '../index.js';
import { admitRequest, refusalMessage } from '../rate-limit.js';
import { classify, readSignals, recordSignal } from '../signal.js';

export async function handleSignal(req: Request, env: Env): Promise<Response> {
  let body: { gaps?: unknown; blocked?: unknown };
  try {
    body = await req.json() as { gaps?: unknown; blocked?: unknown };
  } catch {
    return err('body must be JSON');
  }

  const c = classify(body);
  const accepted = c.gaps.length + c.blocked.length;

  // Charged at least one even when everything was dropped, or a flood of
  // unknown terms would be free. The ceiling is what keeps this open.
  const admitted = await admitRequest(env, req, { cost: Math.max(1, accepted), authed: false });
  if (!admitted.ok) {
    const d = admitted.decision;
    return json(
      { error: refusalMessage(d), counted: { gaps: 0, blocked: 0 } },
      d.refusedBy === 'unreadable' ? 503 : 429,
      d.retryAfterSec ? { 'retry-after': String(d.retryAfterSec) } : {},
    );
  }

  const counted = await recordSignal(env, { gaps: c.gaps, blocked: c.blocked }, Date.now());

  return json({
    ok: true,
    counted,
    dropped: c.dropped,
    truncated: c.truncated,
    note: 'Counts only. No prompt text, no urls and no identity were stored, and '
      + 'nothing recorded here can change a grade.',
  });
}

export async function handleSignals(env: Env): Promise<Response> {
  return json(await readSignals(env));
}
