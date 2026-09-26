/**
 * A ceiling the OPERATOR controls, on money the operator pays.
 *
 * Every existing spend guard in this project protects the caller. `budget.ts`
 * refuses to construct a client without a budget, `enqueue()` refuses without
 * an open permit, and invariant 20 refuses an unknown price. All of that stops
 * the doorman CLI from spending Clemens's money by accident. None of it stops
 * somebody else's audits from spending it on purpose.
 *
 * The 2026-09-19 launch audit put it plainly: the budget guards protect the
 * caller, not you. The moment `GRADE_TOKEN` and `ANTHROPIC_API_KEY` are both
 * set, an accepted paid audit is a model bill, and `CLAUDE.md` already warns
 * that "the first key turns an open endpoint into an open wallet". This is the
 * guard that makes that sentence survivable, and it is deliberately built
 * BEFORE the key exists rather than after the first invoice.
 *
 * ── Where it sits, and why there ───────────────────────────────────────────
 *
 * At the DISPENSE point, not the queue point. `paid_allowed` travels to the
 * runner, and the runner is the thing holding the model key: it spends on what
 * it is handed. Capping at the queue would refuse audits that cost nothing to
 * hold; capping at dispense lets the queue keep accepting work and simply stops
 * paying for it.
 *
 * ── What it does, and what it refuses to do ────────────────────────────────
 *
 * Over the ceiling, an audit is still dispensed, with `paid_allowed = 0`. That
 * is structurally safe by invariant 25: the permit can only ever REMOVE the
 * behavioural layer, never add one, so a downgrade cannot spend. The grade that
 * comes back is a real static grade that says it is static, which is invariant
 * 3 already doing its job.
 *
 * It is never silent. Every downgrade writes a `spend_capped` ledger row, and
 * `/health` carries the posture, because a cap nobody can see looks exactly
 * like a service that quietly stopped doing the expensive half of its job.
 *
 * It fails CLOSED: if the count cannot be read, work is dispensed static-only.
 * An unknown spend position is not a licence to spend, which is invariant 20's
 * "an unknown price is not a free one" pointed at a counter instead of a price.
 */

/** Paid dispenses allowed per rolling 24h. Override with PAID_AUDITS_PER_DAY. */
export const DEFAULT_PAID_AUDITS_PER_DAY = 25;

export interface SpendPosture {
  /** Paid audits handed to a runner in the last 24h. Null when unreadable. */
  dispensed_24h: number | null;
  cap: number;
  /** True when the next paid audit would be downgraded. Null when unknown. */
  capped: boolean | null;
  note: string | null;
}

export function ceilingFor(env: { PAID_AUDITS_PER_DAY?: string }): number {
  const text = (env.PAID_AUDITS_PER_DAY ?? '').trim();
  // An EMPTY variable is unset, not zero. `Number('')` is 0, which would have
  // read a blank value in a config file as "pay for nothing" and silently
  // stopped the expensive half of the service. Zero stays available as a
  // deliberate choice; it just has to be typed.
  if (text === '') return DEFAULT_PAID_AUDITS_PER_DAY;
  const raw = Number(text);
  // A non-numeric or negative override is a misconfiguration, and reading it as
  // "no limit" would be the most expensive possible interpretation.
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_PAID_AUDITS_PER_DAY;
}

/**
 * Pure. Given the position, decide what this one audit is worth.
 *
 * `null` dispensed means the counter could not be read, and the answer there is
 * the same as being over the ceiling: hand it out, do not pay for it.
 */
export function decideDispense(
  { paidAllowed, dispensed, cap }:
  { paidAllowed: number; dispensed: number | null; cap: number },
): { paidAllowed: 0 | 1; downgraded: boolean; reason: string | null } {
  if (paidAllowed !== 1) return { paidAllowed: 0, downgraded: false, reason: null };
  if (dispensed === null) {
    return {
      paidAllowed: 0, downgraded: true,
      reason: 'the paid-audit counter could not be read, so this audit was dispensed static-only',
    };
  }
  if (dispensed >= cap) {
    return {
      paidAllowed: 0, downgraded: true,
      reason: `the operator ceiling of ${cap} paid audits per 24h is reached, ` +
        'so this audit was dispensed static-only',
    };
  }
  return { paidAllowed: 1, downgraded: false, reason: null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many paid audits were handed out in the last 24h. Null when unreadable. */
export async function paidDispensedSince(
  env: { DB: D1Database }, now = Date.now(),
): Promise<number | null> {
  const cutoff = new Date(now - DAY_MS).toISOString();
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ledger WHERE event = 'dispensed_paid' AND created_at >= ?",
    ).bind(cutoff).first<{ n: number }>();
    const n = Number(row?.n);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** The posture, for /health. Reports `null` rather than guessing at zero. */
export async function spendPosture(
  env: { DB: D1Database; PAID_AUDITS_PER_DAY?: string }, now = Date.now(),
): Promise<SpendPosture> {
  const cap = ceilingFor(env);
  const dispensed = await paidDispensedSince(env, now);
  if (dispensed === null) {
    return {
      dispensed_24h: null, cap, capped: null,
      note: 'the paid-audit counter could not be read, so paid work is being ' +
        'dispensed static-only until it can be',
    };
  }
  const capped = dispensed >= cap;
  return {
    dispensed_24h: dispensed, cap, capped,
    note: capped
      ? `the operator ceiling of ${cap} paid audits per 24h is reached; ` +
        'further audits are dispensed static-only until it rolls'
      : null,
  };
}
