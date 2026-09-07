/**
 * The readiness block must never reach the grade.
 *
 * Session 1 found that mcpscore's denominator moves per server and fixed it by
 * normalising to a percentage. This is the same bug one level down: the
 * COMPOSITION of that fraction also moves. mcpscore folds its forward-compat
 * "readiness" rules into the top-level totals for some servers and not others,
 * via `readiness.counted_in_main`, so two normalised percentages can still be
 * measuring different rule sets.
 *
 * The numbers below are real, measured against mcpscore 1.11.0 on 2026-09-02.
 * They are here because the failure is not hypothetical: it inverted the exact
 * comparison the demo puts on screen.
 */

import { describe, expect, it } from 'vitest';
import { splitReadiness, toStaticLayer, type McpscoreReport } from '../src/grade/mcpscore.js';

function report(over: Partial<McpscoreReport> = {}): McpscoreReport {
  return {
    schema_version: 1,
    mcpscore_version: '1.11.0',
    generated_at: '2026-09-02T00:00:00Z',
    target: 'https://example.test/mcp',
    score: 86,
    max_score: 116,
    results: [],
    ...over,
  };
}

describe('readiness is reported, never graded', () => {
  it('subtracts the readiness block when mcpscore counted it', () => {
    // Our own Worker: 86/116 total, readiness 14/43 counted -> 72/73.
    const s = splitReadiness(report({
      score: 86, max_score: 116,
      readiness: { score: 14, max_score: 43, counted_in_main: true },
    }));
    expect(s.score).toBe(72);
    expect(s.max_score).toBe(73);
  });

  it('leaves the totals alone when mcpscore did NOT count it', () => {
    // DeepWiki: 78/91 total, readiness 3/13 NOT counted. Subtracting here
    // would remove points the total never contained and understate the server.
    const s = splitReadiness(report({
      score: 78, max_score: 91,
      readiness: { score: 3, max_score: 13, counted_in_main: false },
    }));
    expect(s.score).toBe(78);
    expect(s.max_score).toBe(91);
    expect(s.readiness).toEqual({ score: 3, max_score: 13, target_version: undefined });
  });

  it('handles a report with no readiness block at all', () => {
    const s = splitReadiness(report({ score: 50, max_score: 60 }));
    expect(s).toEqual({ score: 50, max_score: 60, readiness: null });
  });

  it('un-inverts the comparison the demo puts on screen', () => {
    // The regression this exists to prevent, with the real measured numbers.
    const deepwiki = toStaticLayer(report({
      target: 'https://mcp.deepwiki.com/mcp',
      score: 78, max_score: 91,
      readiness: { score: 3, max_score: 13, counted_in_main: false },
    }));
    const hostile = toStaticLayer(report({
      target: 'https://planted-bad-mcp.wanessalabs-042.workers.dev/mcp',
      score: 81, max_score: 116,
      readiness: { score: 14, max_score: 43, counted_in_main: true },
    }));

    // Before the fix these were 85.71 and 69.83, so the hostile fixture looked
    // like the WORSE-configured server. It is in fact the better-configured
    // one, which is the entire point: its configuration is not the problem.
    expect(deepwiki.pct).toBeCloseTo(85.71, 1);
    expect(hostile.pct).toBeCloseTo(91.78, 1);
    expect(hostile.pct).toBeGreaterThan(deepwiki.pct);
  });

  it('carries readiness through as ungraded information', () => {
    const layer = toStaticLayer(report({
      score: 86, max_score: 116,
      readiness: { score: 14, max_score: 43, counted_in_main: true, target_version: '2026-07-28' },
    }));
    expect(layer.readiness).toEqual({ score: 14, max_score: 43, target_version: '2026-07-28' });
    // and it did not move the graded number
    expect(layer.score).toBe(72);
    expect(layer.max_score).toBe(73);
  });

  it('refuses to grade rather than divide by zero', () => {
    // A report that is nothing but readiness has no main rules to grade. An
    // audit that stops is better than a confident 0% or NaN.
    expect(() => toStaticLayer(report({
      score: 14, max_score: 43,
      readiness: { score: 14, max_score: 43, counted_in_main: true },
    }))).toThrow(/refusing to grade/);
  });
});
