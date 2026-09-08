/**
 * `doorman eval <link> --task <file>` — L3, the two-arm benchmark.
 *
 * Same task, N times, in two images that differ by exactly one install layer.
 * Reports success rate, turns, tool calls, tokens, cost and wall time per arm,
 * and ends in ADOPT / DECLINE / INCONCLUSIVE.
 *
 * The order of the preflight checks below is deliberate. Every one of them can
 * fail without spending a cent, and they are ordered cheapest-refusal-first, so
 * a run that cannot produce a real number never builds an image, never starts a
 * container, and never bills a token.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTaskYaml, validateTask } from './task.mjs';
import { buildArms, cleanup, dockerAvailable, installLayer, runOnce } from './sandbox.mjs';
import { decide, summariseArm, MIN_RUNS_FOR_ADOPT } from './verdict.mjs';
import { openBudget, BudgetError } from '../src/budget.mjs';
import { DEFAULTS, estimateEval, priceFor, renderEstimate, worstCaseRunUsd } from './cost.mjs';

/**
 * Fit the run inside the money, rather than fitting the money to the run.
 *
 * The turn cap used to be a constant, which meant the BUDGET was whatever 24
 * turns happened to cost. Backwards: the ceiling is the input, so the turn cap
 * is derived from it. Returns the largest turn cap whose worst case still fits
 * the per-run allowance, or null when even a minimal run does not fit.
 */
export function turnsWithinBudget(model, perRunAllowanceUsd, floor = 3) {
  if (!priceFor(model)) return null;
  if (worstCaseRunUsd(model, { maxTurns: floor }) > perRunAllowanceUsd) return null;
  let best = floor;
  for (let t = floor; t <= DEFAULTS.maxTurns; t++) {
    if (worstCaseRunUsd(model, { maxTurns: t }) <= perRunAllowanceUsd) best = t;
    else break;
  }
  return best;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function evaluate({ link, taskPath, runs, out, model, log, allowNetwork,
                                maxCostUsd, estimateOnly, ledgerPath }) {
  const started = Date.now();

  // 1. The task must parse and be checkable. Free.
  let task;
  try {
    task = parseTaskYaml(await readFile(taskPath, 'utf8'));
  } catch (e) {
    return { ok: false, why: `task file did not parse: ${e.message}` };
  }
  const problems = validateTask(task, path.basename(taskPath));
  if (problems.length) return { ok: false, why: 'task file is not usable:\n  ' + problems.join('\n  ') };
  log(`task ${task.id}: ${task.title}`);

  // 2. The candidate must be expressible as one install layer. Free.
  const layer = installLayer(link);
  if (layer.kind === 'unsupported') return { ok: false, blocked: 'no-install-layer', why: layer.why };
  log(`candidate ${layer.kind}: ${layer.spec}`);

  // 3. What can this cost, and does it fit? Free, and needs no key: a price
  //    you can only see after configuring a credential is not a price you can
  //    decide on.
  const estimate = estimateEval({ model, runs });
  if (estimateOnly) {
    return { ok: true, estimateOnly: true, estimate, task, layer };
  }
  if (!estimate.priced) {
    return {
      ok: false, blocked: 'unpriced-model',
      why:
        `model "${model}" has no price in cli/cost.mjs, so no ceiling can be enforced.\n` +
        'Refusing to run: an unknown price is not a free one. That rule already ' +
        'governs the doorman spending outward, and it governs spending our own ' +
        'money too.',
    };
  }

  const perRunAllowance = maxCostUsd / (runs * 2);
  const maxTurns = turnsWithinBudget(model, perRunAllowance);
  if (maxTurns === null) {
    const floorCost = worstCaseRunUsd(model, { maxTurns: 3 });
    return {
      ok: false, blocked: 'budget-too-small',
      why:
        `a ceiling of $${maxCostUsd} over ${runs * 2} runs allows ` +
        `$${perRunAllowance.toFixed(2)} per run, and even a 3-turn run can cost ` +
        `$${floorCost.toFixed(2)} at worst on ${model}.\n\n` +
        'Nothing was spent. Options: raise --max-cost, lower --runs, or use a ' +
        'cheaper model: --model claude-haiku-4-5-20251001 is about a third of ' +
        'Sonnet. A local-model backend is designed but NOT built; see ' +
        'evals/ROADMAP.md for the two blockers found on this machine.',
    };
  }
  const perRunWorst = worstCaseRunUsd(model, { maxTurns });
  log(`budget $${maxCostUsd} => ${maxTurns} turns/run, worst $${perRunWorst.toFixed(2)}/run`);

  // 4. Docker must be up. Free.
  const d = await dockerAvailable();
  if (!d.ok) {
    // A prerequisite that is absent is NOT the candidate failing, and the exit
    // code has to say which. adopt.md reads 3 as 'could not measure' and 1 as
    // 'broke'. Recording a stopped Docker daemon as a DECLINE would libel a
    // tool that was never run.
    return {
      ok: false,
      blocked: 'no-docker',
      why:
        'docker is not available, so no sandbox could be built.\n' + d.detail + '\n\n' +
        'Nothing was built and nothing was spent. Start Docker Desktop and re-run.',
    };
  }
  log(`docker ${d.version}`);

  // 5. A key must exist, or there is nothing to measure.
  //    Invariant 9: a missing key stops the run and says so. It does NOT fall
  //    back to a cheaper proxy, because a number produced by a different method
  //    than the one the report describes is a fabricated number.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      blocked: 'no-key',
      why:
        'ANTHROPIC_API_KEY is not set, so no benchmark can run.\n' +
        'L3 measures an agent doing a task; with no model there is no agent.\n' +
        'Nothing was built and nothing was spent.\n\n' +
        '`doorman report <link>` still works and needs no key: it produces the ' +
        'static layer, and the pipeline records the candidate as statically ' +
        'measured and behaviourally unmeasured rather than as failed.',
    };
  }

  // 6. Build the arms.
  const harnessSource = await readFile(path.join(HERE, 'harness.mjs'), 'utf8');
  const arms = await buildArms({ link, harnessSource, log });
  if (!arms.ok) {
    if (arms.installFailed) {
      // A real result: DECLINE without running anything.
      return {
        ok: true,
        verdict: {
          verdict: 'DECLINE', confidence: 'high',
          reasons: [`the candidate does not install: ${arms.why}`],
          note: 'No benchmark was run. A tool that cannot be installed reproducibly cannot be adopted.',
          deltas: null,
        },
        baseline: null, candidate: null, task, layer,
        install_error: arms.detail, eval_cost_usd: 0,
        wall_ms: Date.now() - started,
      };
    }
    return { ok: false, why: arms.why, detail: arms.detail };
  }

  // 7. Run both arms, interleaved.
  //    Interleaved rather than all-baseline-then-all-candidate, so that any
  //    drift over the run window (model-side latency, rate limiting, a noisy
  //    machine) lands on both arms rather than only the second one.
  const baselineRuns = [];
  const candidateRuns = [];
  const netAllowed = Boolean(allowNetwork ?? task.network);
  log(`network inside the sandbox: ${netAllowed ? 'bridge (declared by the task)' : 'none'}`);

  // The same permit machinery the doorman uses to stop itself overspending
  // outward, pointed at our own bill. Reserve the WORST case before a run and
  // settle the actual after: reserving the expected cost would be a limit that
  // only holds when nothing goes wrong.
  let budget;
  try {
    budget = openBudget({ ledgerPath, perRunUsdc: perRunWorst, perDayUsdc: maxCostUsd });
  } catch (e) {
    if (e instanceof BudgetError) return { ok: false, blocked: 'budget-config', why: e.message };
    throw e;
  }

  let stoppedEarly = null;
  try {
    for (let i = 1; i <= runs; i++) {
      for (const [armName, image, bucket] of [
        ['baseline', arms.baseTag, baselineRuns],
        ['candidate', arms.candTag, candidateRuns],
      ]) {
        let permit;
        try {
          permit = budget.reserve({ price_usdc: perRunWorst, server: `${armName} run ${i}` });
        } catch (e) {
          // Out of ceiling. Stop cleanly with what we have rather than
          // half-spending into an arm and reporting a lopsided comparison.
          stoppedEarly = `stopped after ${baselineRuns.length + candidateRuns.length} run(s): ${e.message}`;
          log(stoppedEarly);
          break;
        }
        log(`run ${i}/${runs}: ${armName}`);
        const r = await runOnce({ image, task, apiKey, model, netAllowed, maxTurns });
        bucket.push(r);
        // settle() commits the RESERVED price, and the reservation is the worst
        // case. Settling it directly would charge every run $9 when it cost 30
        // cents, and the ceiling would be gone after six runs that spent two
        // dollars. So: release the guard, then reserve and settle the ACTUAL.
        // The guard did its job by existing before the call; the ledger should
        // record what happened, not what was feared.
        budget.release(permit, 'run finished, actual cost known');
        const actual = typeof r.cost_usd === 'number' ? r.cost_usd : 0;
        try {
          budget.settle(budget.reserve({ price_usdc: actual, server: `${armName} run ${i}` }), {});
        } catch (e) {
          // The actual came in over what remained. Record it and stop: the money
          // is already spent, and pretending otherwise would corrupt the ledger.
          stoppedEarly = `actual spend exceeded the ceiling on ${armName} run ${i}: ${e.message}`;
          log(stoppedEarly);
        }
      }
      if (stoppedEarly) break;
    }
  } finally {
    await cleanup(arms, log);
  }

  // An A/B with unequal arms is not an A/B. If the ceiling cut one arm short,
  // drop the unpaired runs rather than comparing 3 against 2.
  const paired = Math.min(baselineRuns.length, candidateRuns.length);
  if (paired < baselineRuns.length || paired < candidateRuns.length) {
    log(`trimming to ${paired} paired run(s) per arm: an unequal A/B is not a comparison`);
    baselineRuns.length = paired;
    candidateRuns.length = paired;
  }
  if (paired === 0) {
    return {
      ok: false, blocked: 'budget-exhausted',
      why: stoppedEarly || 'the ceiling did not allow a single paired run.',
    };
  }

  const baseline = summariseArm(baselineRuns);
  const candidate = summariseArm(candidateRuns);

  // Anything the sandbox saw that the benchmark did not measure. Egress
  // observation is not wired yet (see evals/ROADMAP.md), so this is empty and
  // the report SAYS it is empty rather than implying the check passed.
  const observations = {};

  const verdict = decide({ baseline, candidate, observations });
  const evalCost =
    [...baselineRuns, ...candidateRuns]
      .map((r) => (typeof r.cost_usd === 'number' ? r.cost_usd : 0))
      .reduce((a, b) => a + b, 0);

  const result = {
    ok: true, verdict, baseline, candidate, task, layer,
    runs_per_arm: paired,
    runs_requested: runs,
    stopped_early: stoppedEarly,
    max_turns: maxTurns,
    max_cost_usd: maxCostUsd,
    spent_today_usd: budget.spentToday(),
    model,
    network: netAllowed ? 'bridge' : 'none',
    egress_observed: false,
    eval_cost_usd: evalCost,
    wall_ms: Date.now() - started,
    raw: { baseline: baselineRuns, candidate: candidateRuns },
  };

  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'eval.json'), JSON.stringify(result, null, 2), 'utf8');
    await writeFile(path.join(out, 'eval.md'), renderMarkdown(result), 'utf8');
    log(`wrote ${path.join(out, 'eval.json')} and eval.md`);
  }
  return result;
}

const pct = (n) => (typeof n === 'number' ? `${(n * 100).toFixed(0)}%` : 'n/a');
const num = (n, d = 1) => (typeof n === 'number' ? n.toFixed(d) : 'n/a');
const delta = (n) => (typeof n === 'number' ? `${n >= 0 ? '+' : ''}${(n * 100).toFixed(0)}%` : 'n/a');

export function renderMarkdown(r) {
  const v = r.verdict;
  const L = [];
  L.push(`# ${v.verdict}: ${r.layer.spec}`);
  L.push('');
  L.push(`**Task** \`${r.task.id}\` · **${r.runs_per_arm} run(s) per arm** · model \`${r.model}\``);
  L.push(`**Eval cost** $${num(r.eval_cost_usd, 4)} · **wall** ${num(r.wall_ms / 1000, 1)}s`);
  L.push('');
  for (const why of v.reasons) L.push(`- ${why}`);
  if (v.note) { L.push(''); L.push(`> ${v.note}`); }

  if (r.baseline && r.candidate) {
    L.push('');
    L.push('| Metric | Baseline | Candidate | Delta |');
    L.push('|---|---:|---:|---:|');
    L.push(`| success rate | ${pct(r.baseline.success_rate)} | ${pct(r.candidate.success_rate)} | ${delta(v.deltas?.success_rate)} |`);
    L.push(`| turns | ${num(r.baseline.mean_turns)} | ${num(r.candidate.mean_turns)} | ${delta(v.deltas?.turns)} |`);
    L.push(`| tool calls | ${num(r.baseline.mean_tool_calls)} | ${num(r.candidate.mean_tool_calls)} | ${delta(v.deltas?.tool_calls)} |`);
    L.push(`| tokens | ${num(r.baseline.mean_tokens, 0)} | ${num(r.candidate.mean_tokens, 0)} | ${delta(v.deltas?.tokens)} |`);
    L.push(`| cost USD | ${num(r.baseline.mean_cost_usd, 4)} | ${num(r.candidate.mean_cost_usd, 4)} | ${delta(v.deltas?.cost_usd)} |`);
    L.push(`| wall ms | ${num(r.baseline.mean_wall_ms, 0)} | ${num(r.candidate.mean_wall_ms, 0)} | ${delta(v.deltas?.wall_ms)} |`);
    L.push('');
    L.push('Means are over SUCCESSFUL runs only. A failed run either bailed early or');
    L.push('spun to the turn cap, and neither is the cost of doing the job.');
  }

  L.push('');
  L.push('## What this did not measure');
  L.push('');
  L.push(`- **Network egress was not observed.** The sandbox ran with \`--network ${r.network}\`, but`);
  L.push('  nothing captured what the candidate actually reached. The automatic-DECLINE');
  L.push('  security clause therefore had no input on this run and did not pass; it did not run.');
  if (r.runs_per_arm < MIN_RUNS_FOR_ADOPT) {
    L.push(`- **${r.runs_per_arm} run(s) per arm is below the ${MIN_RUNS_FOR_ADOPT}** needed to separate a real`);
    L.push('  effect from noise, so ADOPT was not reachable on this run by construction.');
  }
  L.push('');
  L.push('_Generated by `doorman eval`. Numbers come from the runs; the verdict line is a proposal._');
  return L.join('\n') + '\n';
}
