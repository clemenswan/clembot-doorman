/**
 * Grade math. Weights 30 / 50 / 20, hard-fail overrides, bands A/B/C/F.
 *
 * Two rules drive every decision here:
 *
 *  1. Only NORMALISED percentages are comparable. mcpscore returns 78/91 for
 *     one server and 64/73 for another because the denominator moves with how
 *     many rules were skipped. Raw scores must never be compared or summed.
 *
 *  2. A layer that was not measured is not a zero. It is absent, and the
 *     remaining weights renormalise over it. Scoring an unmeasured guidance
 *     delta as 0 would push every honest audit into F.
 */

import {
  BEHAVIORAL_PROBES,
  type Band,
  type GradeInput,
  type GradeResult,
  type LayerBreakdown,
  type ProbeResult,
  type StaticLayer,
} from './types.js';

export const WEIGHTS = { static: 30, behavioral: 50, guidance: 20 } as const;
export const BANDS = { A: 85, B: 70, C: 50 } as const;

/** Cap applied when a hard fail fires. One point under the C floor. */
export const HARD_FAIL_CEILING = 49;

export function bandFor(score: number): Band {
  if (score >= BANDS.A) return 'A';
  if (score >= BANDS.B) return 'B';
  if (score >= BANDS.C) return 'C';
  return 'F';
}

/** Normalise a raw mcpscore report into a comparable percentage. */
export function staticPct(s: Pick<StaticLayer, 'score' | 'max_score'>): number {
  if (!s.max_score || s.max_score <= 0) return 0;
  return round2((s.score / s.max_score) * 100);
}

/**
 * Behavioural layer: mean of the probes that actually applied.
 *
 * Ambiguity only fires when tools overlap; Chain is skipped under 3 tools.
 * A skipped probe is excluded from the mean rather than scored zero — a
 * two-tool server is not worse for having nothing to chain.
 */
/**
 * A probe that could not RUN is not the same as a probe that does not APPLY.
 *
 * `chain` genuinely does not apply to a one-tool server, and excluding it from
 * the average is correct. A probe that threw because the model provider
 * returned 503 is our harness failing, and excluding THAT from the average
 * means an outage raises the server's grade.
 *
 * That is not hypothetical. The first live behavioural run lost three of four
 * probes to Gemini 503s and deepwiki's behavioural layer came back 100%, from
 * the single survivor, lifting the overall grade from 85.71 to 94.64. The
 * report listed the skips honestly and the SCORE did not reflect them, so the
 * number was wrong in the one direction nobody checks.
 */
export function erroredProbes(probes: ProbeResult[]): ProbeResult[] {
  return probes.filter(
    (p) =>
      BEHAVIORAL_PROBES.includes(p.probe_id) &&
      !p.applicable &&
      typeof p.skip_reason === 'string' &&
      p.skip_reason.startsWith('probe error'),
  );
}

export function behavioralPct(probes: ProbeResult[]): number | null {
  // If our own harness could not complete the behavioural layer, we have not
  // measured it. Null means NOT MEASURED and the weights renormalise over the
  // layers that ran, which is invariant 3. Averaging the survivors would
  // publish a number that an outage made better.
  if (erroredProbes(probes).length > 0) return null;

  const scored = probes.filter(
    (p) =>
      BEHAVIORAL_PROBES.includes(p.probe_id) &&
      p.applicable &&
      typeof p.score === 'number',
  );
  if (scored.length === 0) return null;
  const sum = scored.reduce((a, p) => a + (p.score as number), 0);
  return round2(sum / scored.length);
}

/**
 * Guidance delta: how much the drafted recipe improved a cold run.
 *
 * Expressed as recovered headroom, not raw delta. Going 40 -> 70 recovers half
 * the distance to perfect and scores 50. A server already at 95 cannot show a
 * large raw delta and should not be punished for it.
 */
export function guidancePct(
  g: { baseline_pct: number; guided_pct: number } | null | undefined,
): number | null {
  if (!g) return null;
  const headroom = 100 - g.baseline_pct;
  if (headroom <= 0) return 100;              // already perfect cold
  const recovered = (g.guided_pct - g.baseline_pct) / headroom;
  return round2(clamp(recovered * 100, 0, 100));
}

/** Collect every hard fail across the static layer and the probes. */
export function collectHardFails(input: GradeInput): string[] {
  const out: string[] = [];
  if (input.static.hard_fail) out.push(input.static.hard_fail);
  for (const p of input.probes) if (p.hard_fail) out.push(p.hard_fail);
  return out;
}

export function grade(input: GradeInput): GradeResult {
  const sPct = staticPct(input.static);
  const bPct = behavioralPct(input.probes);
  const gPct = guidancePct(input.guidance);

  // Renormalise the weights over the layers that were actually measured.
  const present: Array<['static' | 'behavioral' | 'guidance', number | null]> = [
    ['static', sPct],
    ['behavioral', bPct],
    ['guidance', gPct],
  ];
  const measured = present.filter(([, v]) => v !== null);
  const totalWeight = measured.reduce((a, [k]) => a + WEIGHTS[k], 0);

  const mk = (
    key: 'static' | 'behavioral' | 'guidance',
    pct: number | null,
  ): LayerBreakdown => {
    if (pct === null) return { pct: null, weight: 0, points: 0 };
    const weight = totalWeight > 0 ? round2((WEIGHTS[key] / totalWeight) * 100) : 0;
    return { pct, weight, points: round2((pct * weight) / 100) };
  };

  const layers = {
    static: mk('static', sPct),
    behavioral: mk('behavioral', bPct),
    guidance: mk('guidance', gPct),
  };

  let score = round2(
    layers.static.points + layers.behavioral.points + layers.guidance.points,
  );

  const hardFails = collectHardFails(input);
  const hard_fail = hardFails.length ? hardFails.join('; ') : null;
  if (hard_fail) score = Math.min(score, HARD_FAIL_CEILING);

  const probe_scores: Record<string, number | null> = {};
  for (const p of input.probes) probe_scores[p.probe_id] = p.applicable ? p.score : null;

  return {
    server_url: input.server_url,
    model: input.model,
    score,
    band: bandFor(score),
    hard_fail,
    layers,
    probe_scores,
    worst_failure_modes: worstFailureModes(input),
    graded_at: new Date().toISOString(),
    mcpscore_version: input.static.mcpscore_version,
  };
}

/**
 * The three worst things about this server, in the order a user should care.
 * Hard fails first, then the lowest-scoring probes' own failure modes, then
 * the highest-severity static rule failures.
 */
export function worstFailureModes(input: GradeInput, limit = 3): string[] {
  const out: string[] = [];
  for (const f of collectHardFails(input)) out.push(`HARD FAIL: ${f}`);

  const ranked = input.probes
    .filter((p) => p.applicable && typeof p.score === 'number')
    .sort((a, b) => (a.score as number) - (b.score as number));
  for (const p of ranked) {
    for (const fm of p.failure_modes) {
      if (!out.includes(fm)) out.push(fm);
    }
  }

  const sevRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const rules = [...input.static.failed_rules].sort(
    (a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9),
  );
  for (const r of rules) {
    const line = `[${r.severity}] ${r.rule_id}: ${r.message}`;
    if (!out.includes(line)) out.push(line);
  }

  return out.slice(0, limit);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
