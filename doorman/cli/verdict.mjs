/**
 * ADOPT / DECLINE / INCONCLUSIVE.
 *
 * The whole reason to run two arms is to get a number that a code review cannot
 * produce. That only works if the verdict refuses to overclaim, so the rules
 * here are deliberately conservative in one direction and not the other:
 *
 *   - DECLINE is cheap to reach. Making a candidate worse, or tripping a
 *     security signal, is enough on its own.
 *   - ADOPT is expensive to reach. It needs a real effect AND enough runs to
 *     tell that effect apart from noise.
 *   - INCONCLUSIVE is the default, and it is a RESULT rather than a failure.
 *
 * ## Why one run per arm can never be ADOPT
 *
 * Agent runs are noisy: the same task, same model, temperature 0, still varies
 * in turns and tokens because tool output and timing vary. With a single run
 * per arm there is no way to distinguish a real improvement from one lucky
 * sample, so `MIN_RUNS_FOR_ADOPT` gates it. A cheap one-run eval is still
 * useful, because DECLINE and the security clause both remain reachable: it can
 * tell you a candidate is bad, it just cannot tell you one is good.
 */

/** Below this, an improvement is not distinguishable from run-to-run noise. */
export const MIN_RUNS_FOR_ADOPT = 3;

/** A cost or turn delta smaller than this is treated as no change. */
export const MATERIAL_DELTA = 0.10;

export const VERDICTS = ['ADOPT', 'DECLINE', 'INCONCLUSIVE'];

/**
 * ClemVault's stricter clause, layered ON TOP of the benchmark numbers.
 *
 * `.claude/rules/security.md`: undeclared network access or permission drift
 * observed in the sandbox is an automatic DECLINE regardless of how good the
 * numbers are. A tool that makes the agent faster while phoning somewhere it
 * never declared is not a tool worth adopting, and the benchmark cannot see
 * that, which is exactly why this is a separate gate rather than a weight.
 */
export function securityOverride(observations = {}) {
  const reasons = [];
  const net = observations.undeclared_network;
  if (Array.isArray(net) && net.length) {
    reasons.push(`undeclared network access to ${net.join(', ')}`);
  }
  const perm = observations.permission_escalation;
  if (Array.isArray(perm) && perm.length) {
    reasons.push(`permission escalation: ${perm.join(', ')}`);
  }
  return reasons;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Summarise one arm's runs into the numbers the report compares. */
export function summariseArm(runs) {
  const ok = runs.filter((r) => r.success);
  return {
    runs: runs.length,
    successes: ok.length,
    success_rate: runs.length ? ok.length / runs.length : 0,
    // Averaged over SUCCESSFUL runs only. A failed run's turn count is not
    // comparable: it may have bailed early or spun until a cap, and either way
    // it is not the cost of doing the job.
    mean_turns: mean(ok.map((r) => r.turns).filter((n) => typeof n === 'number')),
    mean_tool_calls: mean(ok.map((r) => r.tool_calls).filter((n) => typeof n === 'number')),
    mean_tokens: mean(ok.map((r) => r.tokens).filter((n) => typeof n === 'number')),
    mean_cost_usd: mean(ok.map((r) => r.cost_usd).filter((n) => typeof n === 'number')),
    mean_wall_ms: mean(ok.map((r) => r.wall_ms).filter((n) => typeof n === 'number')),
  };
}

const rel = (base, cand) => {
  if (typeof base !== 'number' || typeof cand !== 'number' || base === 0) return null;
  return (cand - base) / base;
};

/**
 * Compare two summarised arms and return a verdict with its reasoning.
 *
 * `observations` carries anything the sandbox saw that the task did not measure,
 * and it outranks every number below it.
 */
export function decide({ baseline, candidate, observations = {} }) {
  const why = [];

  const blocked = securityOverride(observations);
  if (blocked.length) {
    return {
      verdict: 'DECLINE',
      confidence: 'high',
      reasons: blocked.map((r) => `SECURITY: ${r}`),
      note:
        'ClemVault rule: a security signal in the sandbox is an automatic DECLINE ' +
        'regardless of benchmark numbers. This is not a close call and is not ' +
        'weighed against the deltas.',
      deltas: null,
    };
  }

  const deltas = {
    success_rate: candidate.success_rate - baseline.success_rate,
    turns: rel(baseline.mean_turns, candidate.mean_turns),
    tool_calls: rel(baseline.mean_tool_calls, candidate.mean_tool_calls),
    tokens: rel(baseline.mean_tokens, candidate.mean_tokens),
    cost_usd: rel(baseline.mean_cost_usd, candidate.mean_cost_usd),
    wall_ms: rel(baseline.mean_wall_ms, candidate.mean_wall_ms),
  };

  // 1. Made it worse. Cheap to reach, deliberately.
  if (candidate.success_rate < baseline.success_rate) {
    return {
      verdict: 'DECLINE',
      confidence: candidate.runs >= MIN_RUNS_FOR_ADOPT ? 'high' : 'low',
      reasons: [
        `success rate fell from ${(baseline.success_rate * 100).toFixed(0)}% to ` +
        `${(candidate.success_rate * 100).toFixed(0)}%`,
      ],
      note:
        candidate.runs < MIN_RUNS_FOR_ADOPT
          ? `Only ${candidate.runs} run(s) per arm, so this is a signal rather than a measurement. ` +
            'It is still a DECLINE: a candidate has to earn adoption, not merely survive it.'
          : null,
      deltas,
    };
  }

  // 2. Not enough evidence to say anything positive.
  if (candidate.runs < MIN_RUNS_FOR_ADOPT || baseline.runs < MIN_RUNS_FOR_ADOPT) {
    return {
      verdict: 'INCONCLUSIVE',
      confidence: 'low',
      reasons: [
        `${Math.min(candidate.runs, baseline.runs)} run(s) per arm is below the ` +
        `${MIN_RUNS_FOR_ADOPT} needed to tell an improvement from run-to-run noise`,
      ],
      note:
        'INCONCLUSIVE never promotes. Re-run with more runs, or with a task that ' +
        'exercises the candidate harder. A cheap run can still DECLINE, which is ' +
        'why it was worth doing.',
      deltas,
    };
  }

  // 3. Real improvement.
  if (candidate.success_rate > baseline.success_rate) {
    why.push(
      `success rate rose from ${(baseline.success_rate * 100).toFixed(0)}% to ` +
      `${(candidate.success_rate * 100).toFixed(0)}%`,
    );
    return { verdict: 'ADOPT', confidence: 'medium', reasons: why, note: null, deltas };
  }

  // 4. Same success, materially cheaper or shorter.
  const cheaper = ['cost_usd', 'tokens', 'turns'].filter(
    (k) => typeof deltas[k] === 'number' && deltas[k] <= -MATERIAL_DELTA,
  );
  const dearer = ['cost_usd', 'tokens', 'turns'].filter(
    (k) => typeof deltas[k] === 'number' && deltas[k] >= MATERIAL_DELTA,
  );

  if (cheaper.length && !dearer.length) {
    return {
      verdict: 'ADOPT',
      confidence: 'medium',
      reasons: [
        'same success rate, and materially cheaper on ' +
        cheaper.map((k) => `${k} ${(deltas[k] * 100).toFixed(0)}%`).join(', '),
      ],
      note: null,
      deltas,
    };
  }

  if (dearer.length && !cheaper.length) {
    return {
      verdict: 'DECLINE',
      confidence: 'medium',
      reasons: [
        'no success-rate gain, and materially more expensive on ' +
        dearer.map((k) => `${k} +${(deltas[k] * 100).toFixed(0)}%`).join(', '),
      ],
      note: 'A tool that costs more and achieves the same is a regression with a nicer name.',
      deltas,
    };
  }

  return {
    verdict: 'INCONCLUSIVE',
    confidence: 'medium',
    reasons: ['no material difference in success rate, cost, tokens or turns'],
    note:
      'The candidate neither helped nor hurt on this task. That is a real finding: ' +
      'either it is not for this workload, or the task does not exercise it. ' +
      'INCONCLUSIVE never promotes.',
    deltas,
  };
}
