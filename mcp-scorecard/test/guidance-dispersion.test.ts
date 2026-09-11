/**
 * The guidance layer must not hide a coin flip behind a mean.
 *
 * MEASURED, NOT HYPOTHESISED. The first real guidance run in this project's
 * history (audit 204ac9a0, deepwiki, 2026-09-11) recorded guided runs of
 * [67, 100, 67] against a baseline of [67, 67, 67]. The recipe rule worked one
 * time in three and never partially. That averages to 78, which is reported as
 * "cold 67 -> guided 78" and reads exactly like a steady partial improvement.
 *
 * The run before it scored 100 guided, so the same server, same model, same
 * single rule graded A 91.59 and then B 78.26. `guidancePct` divides by
 * headroom, so it multiplies any wobble by 100/(100-baseline): threefold at a
 * baseline of 67, tenfold at 90.
 *
 * These tests pin the disclosure, NOT a change to the score. The measurement
 * is real and discarding it would be the mirror of scoring an unmeasured layer
 * zero.
 */

import { describe, it, expect } from 'vitest';
import { measureGuidance } from '../src/probes/guidance.js';
import { buildReport } from '../src/outputs/report.js';
import { grade } from '../src/grade/grade.js';
import type { ProbeContext } from '../src/probes/types.js';
import type { ProbeResult } from '../src/grade/types.js';

/** A cold_open baseline result with the given per-run scores. */
function baselineWith(scores: number[]): ProbeResult {
  return {
    probe_id: 'cold_open',
    applicable: true,
    score: scores.reduce((a, b) => a + b, 0) / scores.length,
    failure_modes: [],
    runs: scores.map((score, run_index) => ({ run_index, score, signals: {}, transcript: [] })),
  } as unknown as ProbeResult;
}

/**
 * Drive measureGuidance without a model by making the guided cold_open return
 * fixed per-run scores. The LLM is stubbed at the context, which is the seam
 * every probe already takes.
 */
function ctxYielding(guidedScores: number[]): ProbeContext {
  let call = 0;
  return {
    runs: guidedScores.length,
    now: () => '2026-09-11T00:00:00.000Z',
    log: () => {},
    needed_for: 'list the documentation topics for a repository',
    inventory: {
      server_name: 'stub',
      tools: [{
        name: 'read_wiki_structure',
        description: 'List documentation topics for a github repository.',
        inputSchema: { type: 'object', properties: { repoName: { type: 'string' } }, required: ['repoName'] },
      }],
    },
    mcp: {
      async listTools() { return []; },
      async callTool() { return { ok: true, content: 'done' }; },
    },
    llm: {
      model: 'stub-model',
      temperature: 0,
      async complete() {
        // One decision per run: call the right tool, or stall. Which runs do
        // which is driven by the caller, so a split result can be constructed.
        const good = guidedScores[Math.min(call++, guidedScores.length - 1)] >= 100;
        return good
          ? {
            stop_reason: 'tool_use', text: '',
            tool_calls: [{ id: '1', name: 'read_wiki_structure', args: { repoName: 'a/b' } }],
            raw: {},
          }
          : { stop_reason: 'end_turn', text: 'Which repository did you mean?', tool_calls: [], raw: {} };
      },
    },
  } as unknown as ProbeContext;
}

const RULES = [{ id: 'r1', text: 'Call read_wiki_structure first with repoName as owner/repo.' }] as never[];

describe('guidance dispersion', () => {
  it('records the per-run scores behind the mean', async () => {
    const m = await measureGuidance({
      ctx: ctxYielding([100, 100, 100]),
      probes: [baselineWith([67, 67, 67])],
      rules: RULES,
    });
    expect(m.measured).toBe(true);
    expect(m.guided_runs).toHaveLength(3);
    expect(m.baseline_runs).toEqual([67, 67, 67]);
  });

  it('marks a unanimous result as unanimous', async () => {
    const m = await measureGuidance({
      ctx: ctxYielding([100, 100, 100]),
      probes: [baselineWith([67, 67, 67])],
      rules: RULES,
    });
    expect(m.unanimous).toBe(true);
    expect(new Set(m.guided_runs)).toHaveProperty('size', 1);
  });

  it('marks a split result as NOT unanimous, and still scores it', async () => {
    // The observed shape. It must not become `not measured`: one run in three
    // recovering is a real finding about the server, not an absence of data.
    const m = await measureGuidance({
      ctx: ctxYielding([67, 100, 67]),
      probes: [baselineWith([67, 67, 67])],
      rules: RULES,
    });
    expect(m.measured).toBe(true);
    expect(m.unanimous).toBe(false);
    expect(new Set(m.guided_runs).size).toBeGreaterThan(1);
    expect(m.guided_pct).not.toBeNull();
  });

  it('does not claim unanimity from a single run', async () => {
    // One run cannot disagree with itself. Reporting `unanimous: true` there
    // would dress a sample of one as agreement between runs.
    const m = await measureGuidance({
      ctx: ctxYielding([100]),
      probes: [baselineWith([67])],
      rules: RULES,
    });
    expect(m.unanimous).toBeUndefined();
  });

  it('leaves the guided MEAN untouched: this discloses, it does not re-score', async () => {
    const split = await measureGuidance({
      ctx: ctxYielding([67, 100, 67]),
      probes: [baselineWith([67, 67, 67])],
      rules: RULES,
    });
    const runs = split.guided_runs ?? [];
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(split.guided_pct).toBeCloseTo(mean, 6);
  });
});

/**
 * The report is where a human actually meets this number, so the disclosure
 * has to survive into it. A field nobody renders is not a disclosure.
 */
describe('guidance dispersion in the report', () => {
  const gradeFor = (m: Awaited<ReturnType<typeof measureGuidance>>) => grade({
    static: { pct: 85.71, hard_fail: null, failed_rules: [], score: 60, max_score: 70, mcpscore_version: '1.11.0' },
    probes: [],
    guidance: m.measured && m.baseline_pct !== null && m.guided_pct !== null
      ? { baseline_pct: m.baseline_pct, guided_pct: m.guided_pct }
      : null,
  } as never);

  it('prints the runs when they disagreed', async () => {
    const m = await measureGuidance({
      ctx: ctxYielding([67, 100, 67]),
      probes: [baselineWith([67, 67, 67])],
      rules: RULES,
    });
    const md = buildReport({ grade: gradeFor(m), probes: [], guidance: m, audit_id: 'aud_split' } as never);
    expect(md).toMatch(/NOT unanimous/);
    expect(md).toMatch(/runs \d+(\/\d+)+/);
  });

  it('stays on one line when the runs agreed', async () => {
    // The common case must not gain noise, or the warning stops standing out.
    const m = await measureGuidance({
      ctx: ctxYielding([100, 100, 100]),
      probes: [baselineWith([67, 67, 67])],
      rules: RULES,
    });
    const md = buildReport({ grade: gradeFor(m), probes: [], guidance: m, audit_id: 'aud_unan' } as never);
    expect(md).not.toMatch(/NOT unanimous/);
    expect(md).toMatch(/cold 67 -> guided 100/);
  });
});
