/**
 * What an eval can cost, before it costs it.
 *
 * The first version of this harness had `MAX_TURNS = 24` and nothing else. That
 * bounds TURNS, not tokens, and the two are not the same by a wide margin,
 * because an agent loop resends the whole conversation every turn. Cost grows
 * with the SQUARE of the turn count, not linearly, and a 24-turn cap quietly
 * authorises far more spend than it looks like it does.
 *
 * Worked, for one run at the defaults:
 *
 *   input at turn k   = prompt + (k-1) x (max_tokens + tool_result_cap)
 *   total input       = T x prompt + (max_tokens + cap) x T(T-1)/2
 *   T=24, cap=5000    = 24 x 1000 + 9096 x 276 = ~2.53M input tokens
 *   total output      = 24 x 4096 = ~98k
 *
 * On Sonnet that is about **$9 for ONE run**, so a 3-run A/B is six runs and
 * roughly **$54**. On Haiku, about $18. Those are the numbers that justify a
 * ceiling rather than a promise to be careful.
 *
 * Typical is far lower, because most runs end in three to six turns. But
 * "typical" is not what you need a limit for.
 *
 * The ceiling reuses `src/budget.mjs`, the same permit machinery the doorman
 * already uses to stop itself overspending outward. Same rule pointed at our
 * own bill: reserve the WORST case before the run, settle the actual after.
 * Reserving the expected cost would be a limit that only holds when nothing
 * goes wrong, which is the opposite of a limit.
 */

/** USD per million tokens. A model absent here has no price and cannot be capped. */
export const PRICES = {
  'claude-opus-5': { in: 15, out: 75 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  // Local models are free at the margin. Not zero-effort, but zero-billing.
  'ollama': { in: 0, out: 0 },
};

export const DEFAULTS = {
  maxTurns: 24,
  maxTokens: 4096,
  toolResultCap: 5000,   // 20000 chars, roughly
  promptTokens: 1000,
};

export function priceFor(model) {
  if (PRICES[model]) return PRICES[model];
  if (String(model).startsWith('ollama/')) return PRICES.ollama;
  return null;
}

/** The most one run can possibly cost. Used for the reservation, not for display alone. */
export function worstCaseRunUsd(model, o = {}) {
  const p = priceFor(model);
  if (!p) return null;
  const { maxTurns, maxTokens, toolResultCap, promptTokens } = { ...DEFAULTS, ...o };
  const perTurnGrowth = maxTokens + toolResultCap;
  const inputTokens = maxTurns * promptTokens + perTurnGrowth * (maxTurns * (maxTurns - 1)) / 2;
  const outputTokens = maxTurns * maxTokens;
  return round4((inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out);
}

/**
 * A rough typical run, for the estimate line only.
 *
 * Labelled clearly wherever it is shown. It is an expectation, and an
 * expectation is not a bound: nothing is ever reserved against this number.
 */
export function typicalRunUsd(model, o = {}) {
  return worstCaseRunUsd(model, { ...o, maxTurns: 5 });
}

export function estimateEval({ model, runs, ...o }) {
  const perRunWorst = worstCaseRunUsd(model, o);
  const perRunTypical = typicalRunUsd(model, o);
  const totalRuns = runs * 2;                  // two arms
  return {
    model,
    runs_per_arm: runs,
    total_runs: totalRuns,
    priced: perRunWorst !== null,
    per_run_worst_usd: perRunWorst,
    per_run_typical_usd: perRunTypical,
    worst_case_usd: perRunWorst === null ? null : round4(perRunWorst * totalRuns),
    typical_usd: perRunTypical === null ? null : round4(perRunTypical * totalRuns),
  };
}

function round4(n) { return Math.round(n * 1e4) / 1e4; }

/**
 * Render the estimate for a human about to spend money.
 *
 * Leads with the worst case, because that is the number the decision needs. A
 * cost warning that leads with the typical figure is an advert.
 */
export function renderEstimate(e) {
  if (!e.priced) {
    return [
      `Model "${e.model}" has no price in the table, so no ceiling can be enforced.`,
      'Refusing to guess: an unknown price is not a free one.',
      'Add it to PRICES in cli/cost.mjs. A local-model backend is designed but not built.',
    ].join('\n');
  }
  if (e.worst_case_usd === 0) {
    return `Local model (${e.model}): $0.00. Nothing is billed. ${e.total_runs} run(s) total.`;
  }
  return [
    `Model ${e.model} · ${e.runs_per_arm} run(s) per arm · ${e.total_runs} runs total`,
    '',
    `  WORST CASE   $${e.worst_case_usd.toFixed(2)}   ($${e.per_run_worst_usd.toFixed(2)} per run)`,
    `  typical      $${e.typical_usd.toFixed(2)}   ($${e.per_run_typical_usd.toFixed(2)} per run)`,
    '',
    'The worst case is what gets reserved before each run. It assumes every run',
    'hits the turn cap with a full tool result every turn. Most do not, and the',
    'unused reservation is released, so you are billed the actual, not the bound.',
  ].join('\n');
}
