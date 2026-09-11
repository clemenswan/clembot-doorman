/**
 * The guidance delta — the third layer, and the one that is easiest to fake.
 *
 * Cold Open asks whether a fresh agent can use this server from the tool
 * descriptions alone. This asks the follow-up question: given the recipe we
 * drafted from watching it fail, can it now?
 *
 * ## What this number means, and what it does not
 *
 * The recipe is derived from the SAME runs it is then measured against. That is
 * not an oversight to be hidden in a footnote; it decides what the number can
 * honestly be called.
 *
 * It is NOT a generalisation claim. We are not measuring "does this recipe help
 * on tasks we have never seen". A rule that says "call `search`, not `fetch`"
 * was written because the agent reached for `fetch` on this exact task, and of
 * course it fixes this exact task.
 *
 * It IS a recoverability claim, and that is the useful one:
 *
 *   > We told the agent, in plain language, exactly what went wrong last time.
 *   > Did that fix it?
 *
 * A server that recovers is one you can safely put behind a recipe. A server
 * that STILL fails with the correction sitting in its system prompt is one
 * where no amount of documentation saves you: the tools themselves are the
 * problem. That is the finding worth having, and it is a LOW score, not a high
 * one. High is the boring, expected result.
 *
 * Every gate below exists so the layer reports `not measured` instead of a
 * number nobody can defend. An unmeasured layer renormalises the weights and
 * costs a server nothing. A vacuous 100 would hand it twenty free points.
 */

import type { ProbeResult } from '../grade/types.js';
import type { RecipeRule } from '../outputs/recipe.js';
import { coldOpen } from './cold_open.js';
import type { ProbeContext } from './types.js';

export interface GuidanceMeasurement {
  /** False means the layer is absent, NOT that it scored zero. */
  measured: boolean;
  /** Present whenever `measured` is false. Always says which gate stopped it. */
  skip_reason?: string;
  /** How many recipe rules the guided agent was handed. */
  rules_given: number;
  baseline_pct: number | null;
  guided_pct: number | null;
  /** The recipe made it WORSE. guidancePct floors at 0 and would hide this. */
  regression: boolean;
  /**
   * The per-run scores behind `guided_pct`, and behind `baseline_pct`.
   *
   * THE MEAN ALONE IS NOT ENOUGH, and this is not a theoretical concern. The
   * first real guidance measurement recorded guided runs of `[67, 100, 67]`:
   * the recipe rule worked ONE TIME IN THREE and never partially. That
   * averages to 78 and reads exactly like a steady partial improvement, which
   * is a different claim about the server and a different decision for a
   * reader. `[78, 78, 78]` would produce the same mean, the same 33.33% layer
   * and the same final grade.
   *
   * It also decided a band. The run before scored `100` guided, so the same
   * server graded A 91.59 then B 78.26 on nothing but which way the coin
   * landed, because `guidancePct` divides by headroom and multiplies any
   * wobble by `100 / (100 - baseline)`: threefold here, tenfold at a baseline
   * of 90.
   */
  baseline_runs?: number[];
  guided_runs?: number[];
  /**
   * Did every guided run agree?
   *
   * Deliberately unanimity rather than a spread threshold. Any threshold here
   * would be a number invented to make this look tidy, and the observed data
   * is bimodal (67 or 100, never between), so "did they agree" is the question
   * the data can actually answer. False does NOT invalidate the score: the
   * measurement is real and discarding it would be the mirror of scoring an
   * unmeasured layer zero. It means the mean is hiding a coin flip and the
   * reader needs to see the runs.
   */
  unanimous?: boolean;
  /**
   * The full guided Cold Open result, transcripts included.
   *
   * Deliberately returned SEPARATELY rather than appended to the audit's
   * probe list. `behavioralPct` averages by probe id, so a second `cold_open`
   * entry would fold the guided score into the behavioural layer and inflate
   * it — the server would be paid twice for the same recovery. A test asserts
   * the behavioural percentage is byte-identical with and without this.
   */
  guided?: ProbeResult;
}

/**
 * The text handed to the guided agent, as a system-prompt block.
 *
 * Built from the STRUCTURED rules rather than by re-parsing recipe.md, because
 * the markdown carries things the guided run must never see:
 *
 *   - the grade and band, which invite the model to reason about our scoring
 *   - the hard-fail banner, which says "Do not use this server". Feed that to
 *     the guided agent and it refuses, scores 0, and the delta measures our
 *     own warning instead of the guidance.
 *
 * The rule text is included verbatim; the `because` clause is not, so the
 * agent gets the instruction without a transcript of how we caught it.
 */
export function guidanceBlock(rules: RecipeRule[]): string {
  const lines = [
    '',
    'You have been given a usage recipe for this server, drafted from a previous',
    'audit of it. Follow these rules exactly:',
    '',
  ];
  rules.forEach((r, i) => lines.push(`${i + 1}. ${r.rule}`));
  return lines.join('\n');
}

export const NO_RULES =
  'the recipe derived no rules, so there is nothing to measure';
export const NO_BASELINE =
  'cold_open produced no baseline score to improve on';
export const NO_HEADROOM =
  'cold open already scored 100; there is no headroom for a recipe to recover';

/**
 * Run Cold Open a second time with the recipe in front of the agent.
 *
 * Everything else is held constant on purpose: same task, same run count, same
 * step budget, same temperature, same tools. Change any of them and the delta
 * stops measuring guidance and starts measuring the change in budget.
 */
export async function measureGuidance(args: {
  ctx: ProbeContext;
  probes: ProbeResult[];
  rules: RecipeRule[];
}): Promise<GuidanceMeasurement> {
  const { ctx, probes, rules } = args;
  const none = (skip_reason: string): GuidanceMeasurement => ({
    measured: false,
    skip_reason,
    rules_given: rules.length,
    baseline_pct: null,
    guided_pct: null,
    regression: false,
  });

  if (rules.length === 0) return none(NO_RULES);

  const baseline = probes.find((p) => p.probe_id === 'cold_open');
  if (!baseline?.applicable || typeof baseline.score !== 'number') {
    return none(baseline?.skip_reason ? `${NO_BASELINE} (${baseline.skip_reason})` : NO_BASELINE);
  }
  if (baseline.score >= 100) return none(NO_HEADROOM);

  const guided = await coldOpen.run({ ...ctx, guidance: guidanceBlock(rules) });
  const guided_pct = typeof guided.score === 'number' ? guided.score : null;
  if (guided_pct === null) return none('the guided pass produced no score');

  const guided_runs = guided.runs.map((r) => r.score).filter((s): s is number => typeof s === 'number');
  const baseline_runs = baseline.runs.map((r) => r.score).filter((s): s is number => typeof s === 'number');

  return {
    measured: true,
    rules_given: rules.length,
    baseline_pct: baseline.score,
    guided_pct,
    regression: guided_pct < baseline.score,
    baseline_runs,
    guided_runs,
    // One run cannot disagree with itself, so unanimity is only a claim worth
    // making when there is more than one run to compare.
    unanimous: guided_runs.length > 1 ? new Set(guided_runs).size === 1 : undefined,
    guided,
  };
}

/** The `{ baseline_pct, guided_pct }` shape the grade math takes, or null. */
export function toGradeInput(
  m: GuidanceMeasurement,
): { baseline_pct: number; guided_pct: number } | null {
  if (!m.measured || m.baseline_pct === null || m.guided_pct === null) return null;
  return { baseline_pct: m.baseline_pct, guided_pct: m.guided_pct };
}
