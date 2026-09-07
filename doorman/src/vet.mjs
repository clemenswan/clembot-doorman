/**
 * The two-phase vet. Fit first, money second.
 *
 * Two questions, in this order, and the order is the whole feature:
 *
 *   1. Does MY system need this?      free, local, one model call
 *   2. Can I afford to find out?      free, local, a spend cap
 *   3. Is it trustworthy?             paid, external, the scorecard
 *
 * Question 2 exists because an agent that can spend on your behalf while you
 * are asleep is only as safe as the thing that says no. The price is DISCOVERED
 * from the service, never assumed: a client that defaults an unknown price to
 * zero passes every cap it has, forever.
 *
 * A `redundant` or `out-of-scope` verdict RETURNS BEFORE the scorecard client
 * is constructed. Not before it is called: before it exists. A path that cannot
 * spend money is easier to prove than a path that remembers not to.
 *
 * Everything is injected, so the whole flow runs offline in tests with a
 * scorecard stub that throws on contact.
 */

import { detectCandidate, mayBeGraded } from './candidate.mjs';
import { fitReview } from './fit-review.mjs';
import { gatherInventory, renderInventory, findInventoryRoot } from './inventory.mjs';
import { fetchInstructions } from './instructions.mjs';
import { sniffInstructions } from './injection.mjs';

/** Verdicts that stop the flow before anything is paid for. */
export const STOP_VERDICTS = ['redundant', 'out-of-scope'];

/** Owner used when the caller does not supply one. */
export const DEFAULT_OWNER = 'doorman';

export class VetError extends Error {}

/**
 * @param {string} input                url, repo, or path
 * @param {object} deps
 * @param {object} deps.llm             for the fit review
 * @param {Function} [deps.makeScorecard]  () => client. NOT called on a stop path.
 * @param {object} [deps.inventory]     pre-gathered; otherwise read from disk
 * @param {string} [deps.needed_for]
 * @param {string} [deps.type]          force the candidate type
 * @param {Function} [deps.fetch]       for instruction text
 * @param {Function} [deps.now]
 */
export async function runVet(input, deps = {}) {
  const {
    llm, makeScorecard, budget, needed_for, type,
    inventoryRoot, registryDir, fetch: f, now = () => new Date(),
  } = deps;

  const candidate = detectCandidate(input, type ? { type } : undefined);
  candidate.needed_for = needed_for;

  const inventory = deps.inventory ?? gatherInventory({
    root: inventoryRoot ?? findInventoryRoot(process.cwd()),
    registryDir,
  });

  const result = {
    candidate,
    reviewed: now().toISOString().slice(0, 10),
    fit: null,
    scan: null,
    grade: null,
    audit_id: null,
    transcripts: null,
    cost_usdc: 0,
    paid: false,
    price: null,
    budget: budget
      ? { per_run_usdc: budget.perRunUsdc, per_day_usdc: budget.perDayUsdc,
          spent_today_usdc: budget.spentToday(), remaining_usdc: budget.remainingToday() }
      : null,
    stopped_at: null,
  };

  // ── Phase 1: fit. Free. ────────────────────────────────────────────────────
  result.fit = await fitReview(candidate, inventory, { llm, renderInventory });

  if (STOP_VERDICTS.includes(result.fit.verdict)) {
    // The point of the whole feature. No client, no request, no charge.
    result.stopped_at = 'fit';
    return result;
  }

  // ── Phase 2a: a skill or a repo is scanned, never graded. ──────────────────
  if (!mayBeGraded(candidate.type)) {
    const text = await fetchInstructions(candidate, f ? { fetch: f } : undefined);
    result.scan = {
      ...sniffInstructions(text.text, candidate.type === 'repo' ? 'README.md' : 'SKILL.md'),
      source: text.source,
      bytes: text.bytes,
      truncated: text.truncated,
    };
    // Said in the result rather than left for the reader to infer from a null.
    result.grade = null;
    result.behavioral = 'n/a - no tools to probe';
    result.stopped_at = 'scan';
    return result;
  }

  // ── Phase 2b: an MCP server that the system actually needs. Paid. ──────────
  if (!makeScorecard) {
    throw new VetError(
      'fit passed and this candidate is gradeable, but no scorecard client was ' +
      'supplied. Refusing to report a verdict with no grade behind it.',
    );
  }
  if (!budget) {
    throw new VetError(
      'fit passed and this candidate is gradeable, but no budget was supplied. ' +
      'Refusing to reach a paid path with no spend cap. Build one with ' +
      'openBudget() and pass it as deps.budget.',
    );
  }
  const scorecard = makeScorecard();

  // The cache is free, and checking it BEFORE reserving means an exhausted
  // budget still answers from cache rather than refusing a question that costs
  // nothing. Refusing a free read to enforce a spend cap would be theatre.
  const cached = await scorecard.cached(candidate.id);
  if (cached) {
    result.grade = cached;
    result.audit_id = cached.audit_id;
    result.transcripts = scorecard.transcriptsUrl(cached.audit_id);
    result.stopped_at = 'cached';
    return result;                          // a cache hit is still not a purchase
  }

  // ── Phase 2c: the money. Discover the price, reserve, then spend. ──────────
  result.price = await scorecard.price();
  if (!result.price.known) {
    result.stopped_at = 'price-unknown';
    result.why = result.price.why;
    return result;                          // an unknown price is not a free one
  }

  let permit;
  try {
    permit = budget.reserve({
      price_usdc: result.price.price_usdc,
      server: candidate.id,
    });
  } catch (e) {
    // A refusal, not a failure. The caller gets a result to print, and the
    // reason, rather than a stack trace.
    result.stopped_at = 'budget';
    result.why = e.message;
    return result;
  }

  try {
    const queued = await scorecard.enqueue({
      url: candidate.id, name: candidate.host ?? undefined, needed_for, permit,
    });
    budget.settle(permit, { audit_id: queued.audit_id });
    result.audit_id = queued.audit_id;
    result.transcripts = scorecard.transcriptsUrl(queued.audit_id);
    result.cost_usdc = permit.price_usdc;
    result.paid = permit.price_usdc > 0;    // a free call is not a purchase
    result.stopped_at = 'queued';
  } catch (e) {
    // The call did not happen, so the headroom goes back. Releasing on the
    // error path is the whole reason reserve and settle are separate steps.
    budget.release(permit, 'enqueue failed: ' + e.message);
    throw e;
  }
  result.budget.spent_today_usdc = budget.spentToday();
  result.budget.remaining_usdc = budget.remainingToday();
  return result;
}
