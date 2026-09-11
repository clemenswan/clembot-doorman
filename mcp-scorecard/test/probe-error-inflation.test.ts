/**
 * An outage must never improve a server's grade.
 *
 * FOUND LIVE, not in review. The first behavioural audit ever run lost three of
 * four probes to Gemini 503s. `behavioralPct` averaged the one survivor, the
 * behavioural layer came back 100%, and deepwiki's overall grade rose from
 * 85.71 to 94.64. The report listed the three skips honestly; the score did
 * not reflect them. The number was wrong in the one direction nobody audits.
 *
 * The distinction that fixes it: a probe that does not APPLY (chain, against a
 * one-tool server) is correctly excluded from the average. A probe that could
 * not RUN is our harness failing, and cannot be quietly dropped.
 */
import { describe, expect, it } from 'vitest';
import { behavioralPct, erroredProbes } from '../src/grade/grade.js';
import type { ProbeResult } from '../src/grade/types.js';

const probe = (id: string, over: Partial<ProbeResult> = {}): ProbeResult => ({
  probe_id: id,
  applicable: true,
  score: 100,
  runs: [],
  ...over,
} as ProbeResult);

const errored = (id: string) =>
  probe(id, { applicable: false, score: null, skip_reason: 'probe error: Gemini HTTP 503: {' });

const inapplicable = (id: string, why: string) =>
  probe(id, { applicable: false, score: null, skip_reason: why });

describe('a provider outage cannot raise a grade', () => {
  it('the exact shape of the live incident returns null, not 100', () => {
    const probes = [
      probe('cold_open', { score: 100 }),
      errored('ambiguity'),
      errored('bad_input'),
      errored('chain'),
    ];
    expect(erroredProbes(probes).length).toBe(3);
    // Before the fix this was 100: the single survivor carried the layer.
    expect(behavioralPct(probes)).toBe(null);
  });

  it('one errored probe is enough to stop publishing the layer', () => {
    expect(behavioralPct([probe('cold_open'), probe('ambiguity'), errored('bad_input')])).toBe(null);
  });

  it('a probe that legitimately does not apply is still excluded, not fatal', () => {
    // This is the case the exclusion was written for and it must keep working.
    const probes = [
      probe('cold_open', { score: 80 }),
      probe('ambiguity', { score: 100 }),
      inapplicable('chain', 'the server exposes one tool, so there is nothing to chain'),
    ];
    expect(erroredProbes(probes).length).toBe(0);
    expect(behavioralPct(probes)).toBe(90);
  });

  it('a clean full run is unaffected', () => {
    expect(behavioralPct([
      probe('cold_open', { score: 100 }),
      probe('ambiguity', { score: 50 }),
    ])).toBe(75);
  });

  it('no behavioural probes at all is still null', () => {
    expect(behavioralPct([])).toBe(null);
  });

  it('an errored probe is detected by its reason, not by its score being null', () => {
    // Both have score null. Only one is our fault.
    expect(erroredProbes([inapplicable('chain', 'nothing to chain')]).length).toBe(0);
    expect(erroredProbes([errored('chain')]).length).toBe(1);
  });
});
