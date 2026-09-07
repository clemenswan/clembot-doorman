/**
 * The spend cap. The doorman's second refusal, after fit.
 *
 * Fit answers "does my system need this at all". This answers "can I afford to
 * find out". They are different refusals and both have to be structural,
 * because an agent that can spend money on your behalf while you are asleep is
 * only as safe as the thing that says no.
 *
 * ## The guarantee, and why it is a permit
 *
 * `scorecard.enqueue()` will not spend without a **permit**, and a permit is
 * single-use. That is stronger than checking a number before calling: a check
 * can be skipped by a new code path, forgotten in a refactor, or bypassed by a
 * caller that does not know it exists. A required argument cannot.
 *
 *     const permit = budget.reserve({ price_usdc, server });   // may throw
 *     await scorecard.enqueue({ ..., permit });                // throws without
 *     budget.settle(permit, { audit_id });
 *
 * Same shape as invariant 13: a path that CANNOT spend is easier to prove than
 * a path that remembers not to.
 *
 * ## An unknown price is not free
 *
 * `reserve()` refuses a null, undefined, negative or non-finite price. The
 * tempting default is 0, and 0 passes every cap forever. This is the same
 * mistake as scoring an unmeasured layer zero, pointed at money instead of at
 * a grade.
 *
 * ## Reservations count against the cap until they are released
 *
 * The ledger is written BEFORE the call, not after. If the process dies
 * mid-request, the ledger shows a reservation that never settled, and today's
 * spend is over-counted rather than under-counted. Over-counting refuses a call
 * you could have afforded; under-counting spends money you did not have. Only
 * one of those is recoverable by waiting until tomorrow.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class BudgetError extends Error {}
export class BudgetExceededError extends BudgetError {}

/** Deliberately small. A cap you have to raise on purpose is doing its job. */
export const DEFAULT_PER_RUN_USDC = 1;
export const DEFAULT_PER_DAY_USDC = 5;

/**
 * @param {object} opts
 * @param {string} [opts.ledgerPath]     NDJSON, append-only. Omit for in-memory.
 * @param {number} [opts.perRunUsdc]
 * @param {number} [opts.perDayUsdc]
 * @param {Function} [opts.now]          injectable clock
 * @param {Function} [opts.randomId]     injectable id, for deterministic tests
 */
export function openBudget(opts = {}) {
  const {
    ledgerPath,
    perRunUsdc = DEFAULT_PER_RUN_USDC,
    perDayUsdc = DEFAULT_PER_DAY_USDC,
    now = () => new Date(),
    randomId = () => 'permit_' + Math.random().toString(36).slice(2, 10),
  } = opts;

  for (const [k, v] of Object.entries({ perRunUsdc, perDayUsdc })) {
    if (!Number.isFinite(v) || v < 0) {
      throw new BudgetError(`${k} must be a finite number >= 0, got ${v}`);
    }
  }
  if (perRunUsdc > perDayUsdc) {
    // Not a hypothetical: it means one call can exceed the daily cap, so the
    // daily cap silently does nothing. Better to refuse the configuration.
    throw new BudgetError(
      `perRunUsdc (${perRunUsdc}) is above perDayUsdc (${perDayUsdc}), so the ` +
      'daily cap could never bind. Fix the configuration rather than shipping ' +
      'a limit that does not limit.',
    );
  }

  /** In-memory mirror. The file is the record; this avoids re-reading per call. */
  const loaded = ledgerPath ? readLedger(ledgerPath) : { entries: [], skipped: 0 };
  const entries = loaded.entries;
  const open = new Map();          // permit id -> reservation, unsettled

  const write = (entry) => {
    entries.push(entry);
    if (!ledgerPath) return;
    mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf8');
  };

  const today = () => now().toISOString().slice(0, 10);

  /**
   * Committed plus outstanding, for today only.
   *
   * A `release` cancels its own `reserve`. A `settle` does not: settling means
   * the money went out, so it stays counted.
   */
  const spentToday = () => {
    const day = today();
    const released = new Set(
      entries.filter((e) => e.event === 'release').map((e) => e.permit),
    );
    return round4(
      entries
        .filter((e) => e.event === 'reserve' && e.ts.slice(0, 10) === day)
        .filter((e) => !released.has(e.permit))
        .reduce((a, e) => a + e.price_usdc, 0),
    );
  };

  return {
    perRunUsdc,
    perDayUsdc,
    ledgerPath: ledgerPath ?? null,
    spentToday,
    remainingToday: () => round4(Math.max(0, perDayUsdc - spentToday())),
    entries: () => entries.slice(),
    /** Unparseable ledger lines found at open. Reported, never silently zero. */
    damagedLines: loaded.skipped,

    /**
     * Claim headroom for one paid call. Throws rather than returning a falsy
     * value: a caller that ignores a return value must not end up spending.
     * @returns {{id: string, price_usdc: number, server: string, ts: string}}
     */
    reserve({ price_usdc, server = '(unnamed)' } = {}) {
      if (typeof price_usdc !== 'number' || !Number.isFinite(price_usdc)) {
        throw new BudgetError(
          'reserve() needs a numeric price_usdc. An unknown price is not a free ' +
          'one: refusing to spend against a number nobody supplied. Read the ' +
          'price from the 402 challenge, or set it in config.',
        );
      }
      if (price_usdc < 0) throw new BudgetError('price_usdc cannot be negative');

      if (price_usdc > perRunUsdc) {
        throw new BudgetExceededError(
          `this call costs ${price_usdc} USDC and the per-run cap is ${perRunUsdc}. ` +
          'Nothing was spent.',
        );
      }
      const after = round4(spentToday() + price_usdc);
      if (after > perDayUsdc) {
        throw new BudgetExceededError(
          `this call costs ${price_usdc} USDC, today's spend is already ` +
          `${spentToday()}, and the daily cap is ${perDayUsdc}. Nothing was spent.`,
        );
      }

      const permit = {
        id: randomId(),
        price_usdc,
        server,
        ts: now().toISOString(),
      };
      open.set(permit.id, permit);
      write({
        event: 'reserve', permit: permit.id, price_usdc,
        server, ts: permit.ts,
      });
      return permit;
    },

    /** The call happened. The money is spent and stays counted. */
    settle(permit, { audit_id = null } = {}) {
      assertOpen(open, permit);
      open.delete(permit.id);
      write({
        event: 'settle', permit: permit.id, price_usdc: permit.price_usdc,
        server: permit.server, audit_id, ts: now().toISOString(),
      });
      return permit;
    },

    /** The call did not happen. Give the headroom back, with a reason. */
    release(permit, reason = 'unspecified') {
      assertOpen(open, permit);
      open.delete(permit.id);
      write({
        event: 'release', permit: permit.id, price_usdc: permit.price_usdc,
        server: permit.server, reason, ts: now().toISOString(),
      });
      return permit;
    },

    /**
     * Used by the paid client. A permit is valid exactly once and only while
     * open, so a replayed or already-settled permit cannot buy a second audit.
     */
    isOpen: (permit) => Boolean(permit?.id) && open.has(permit.id),
  };
}

function assertOpen(open, permit) {
  if (!permit?.id) throw new BudgetError('not a permit');
  if (!open.has(permit.id)) {
    throw new BudgetError(
      `permit ${permit.id} is not open: it was already settled or released. ` +
      'Reserve a new one rather than reusing this.',
    );
  }
}

/**
 * Read an NDJSON ledger, skipping lines that do not parse.
 *
 * A corrupt line is skipped rather than thrown on, because a half-written line
 * from a killed process must not lock the doorman out of spending forever. It
 * is counted in `skipped` so the CLI can say the ledger is damaged instead of
 * quietly under-counting the day.
 *
 * @returns {{entries: object[], skipped: number}}
 */
export function readLedger(path) {
  if (!existsSync(path)) return { entries: [], skipped: 0 };
  const out = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.price_usdc === 'number' && typeof e.ts === 'string') out.push(e);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { entries: out, skipped };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
