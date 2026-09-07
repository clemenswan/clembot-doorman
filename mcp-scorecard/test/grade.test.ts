import { describe, expect, it } from 'vitest';
import {
  BANDS, HARD_FAIL_CEILING, WEIGHTS,
  bandFor, behavioralPct, grade, guidancePct, staticPct, worstFailureModes,
} from '../src/grade/grade.js';
import type { GradeInput, ProbeId, ProbeResult, StaticLayer } from '../src/grade/types.js';

const baseStatic: StaticLayer = {
  score: 78, max_score: 91, pct: 0,
  mcpscore_version: '1.11.0',
  failed_rules: [],
};

function probe(id: ProbeId, score: number | null, applicable = true): ProbeResult {
  return { probe_id: id, applicable, runs: [], score, failure_modes: [] };
}

function input(over: Partial<GradeInput> = {}): GradeInput {
  return {
    server_url: 'https://example.test/mcp',
    model: 'claude-sonnet-5',
    static: { ...baseStatic, pct: staticPct(baseStatic) },
    probes: [probe('cold_open', 80), probe('bad_input', 60)],
    guidance: null,
    ...over,
  };
}

describe('bands', () => {
  it('maps the documented thresholds', () => {
    expect(bandFor(100)).toBe('A');
    expect(bandFor(85)).toBe('A');
    expect(bandFor(84.99)).toBe('B');
    expect(bandFor(70)).toBe('B');
    expect(bandFor(69.99)).toBe('C');
    expect(bandFor(50)).toBe('C');
    expect(bandFor(49.99)).toBe('F');
    expect(bandFor(0)).toBe('F');
  });

  it('uses the constants the spec names', () => {
    expect(BANDS).toEqual({ A: 85, B: 70, C: 50 });
    expect(WEIGHTS).toEqual({ static: 30, behavioral: 50, guidance: 20 });
  });
});

describe('staticPct normalisation', () => {
  it('normalises the variable denominator to a percentage', () => {
    expect(staticPct({ score: 78, max_score: 91 })).toBe(85.71);
    expect(staticPct({ score: 64, max_score: 73 })).toBe(87.67);
  });

  it('ranks servers differently than raw scores would', () => {
    // This is why normalisation is not cosmetic. Server A has the HIGHER raw
    // score and the LOWER quality. Comparing raw scores ranks them backwards.
    const a = { score: 78, max_score: 91 };
    const b = { score: 64, max_score: 73 };
    expect(a.score).toBeGreaterThan(b.score);
    expect(staticPct(a)).toBeLessThan(staticPct(b));
  });

  it('does not divide by zero', () => {
    expect(staticPct({ score: 0, max_score: 0 })).toBe(0);
  });
});

describe('behavioural layer', () => {
  it('averages only the probes that applied', () => {
    expect(behavioralPct([probe('cold_open', 100), probe('bad_input', 50)])).toBe(75);
  });

  it('excludes a skipped probe rather than scoring it zero', () => {
    const withSkip = behavioralPct([
      probe('cold_open', 100),
      probe('bad_input', 50),
      probe('chain', null, false),
    ]);
    // 50 would be the answer if a skipped probe counted as a zero.
    expect(withSkip).toBe(75);
  });

  it('ignores injection_sniff, which is a gate and not a score', () => {
    expect(behavioralPct([probe('cold_open', 100), probe('injection_sniff', 0)])).toBe(100);
  });

  it('excludes a not-applicable probe even if it carries a stale score', () => {
    // skipped() nulls the score, so today applicable:false always implies
    // score:null and the applicable check looks redundant. It is not: it is
    // the guard that keeps a hand-built or future ProbeResult with a leftover
    // score out of the mean. Removing it must break a test.
    const stale: ProbeResult = {
      probe_id: 'chain', applicable: false, skip_reason: 'only 2 tools',
      runs: [], score: 0, failure_modes: [],
    };
    expect(behavioralPct([probe('cold_open', 100), stale])).toBe(100);
  });

  it('returns null when nothing applied', () => {
    expect(behavioralPct([probe('chain', null, false)])).toBeNull();
  });
});

describe('guidance delta', () => {
  it('scores recovered headroom, not raw delta', () => {
    expect(guidancePct({ baseline_pct: 40, guided_pct: 70 })).toBe(50);
  });

  it('does not punish a server that was already near-perfect cold', () => {
    // Only 5 points of headroom existed. Recovering 4 of them is excellent,
    // and a raw-delta score would have called it a 4 out of 100.
    expect(guidancePct({ baseline_pct: 95, guided_pct: 99 })).toBe(80);
  });

  it('treats a perfect cold run as full marks', () => {
    expect(guidancePct({ baseline_pct: 100, guided_pct: 100 })).toBe(100);
  });

  it('floors at zero when the recipe made things worse', () => {
    expect(guidancePct({ baseline_pct: 60, guided_pct: 30 })).toBe(0);
  });

  it('is null when the layer was not measured', () => {
    expect(guidancePct(null)).toBeNull();
    expect(guidancePct(undefined)).toBeNull();
  });
});

describe('weight renormalisation', () => {
  it('renormalises 30/50 to 37.5/62.5 when guidance was not measured', () => {
    const g = grade(input({ guidance: null }));
    expect(g.layers.static.weight).toBe(37.5);
    expect(g.layers.behavioral.weight).toBe(62.5);
    expect(g.layers.guidance.weight).toBe(0);
    expect(g.layers.static.weight + g.layers.behavioral.weight).toBe(100);
  });

  it('uses the full 30/50/20 when all three layers are measured', () => {
    const g = grade(input({ guidance: { baseline_pct: 40, guided_pct: 70 } }));
    expect(g.layers.static.weight).toBe(30);
    expect(g.layers.behavioral.weight).toBe(50);
    expect(g.layers.guidance.weight).toBe(20);
  });

  it('does not let an unmeasured layer drag an honest audit into F', () => {
    // Static 85.71, behavioural 100, guidance not run. Scoring the missing
    // layer as a zero against a 20-point weight would cost roughly 19 points
    // and turn a genuine A into a B.
    const g = grade(input({
      probes: [probe('cold_open', 100), probe('bad_input', 100)],
      guidance: null,
    }));
    expect(g.band).toBe('A');
    expect(g.score).toBeGreaterThan(90);
  });
});

describe('hard fails', () => {
  it('caps a strong server at F when TLS is missing', () => {
    const g = grade(input({
      static: { ...baseStatic, pct: 85.71, hard_fail: 'transport is not TLS-encrypted' },
      probes: [probe('cold_open', 100), probe('bad_input', 100)],
    }));
    expect(g.score).toBe(HARD_FAIL_CEILING);
    expect(g.band).toBe('F');
    expect(g.hard_fail).toContain('TLS');
  });

  it('caps at F on injection-shaped content', () => {
    const inj: ProbeResult = {
      probe_id: 'injection_sniff', applicable: true, runs: [], score: 0,
      failure_modes: ['injection-shaped content in tool:x.description'],
      hard_fail: 'injection-shaped content in 1 location(s): tool:x.description',
    };
    const g = grade(input({ probes: [probe('cold_open', 100), inj] }));
    expect(g.band).toBe('F');
    expect(g.score).toBe(HARD_FAIL_CEILING);
  });

  it('never RAISES a score up to the ceiling', () => {
    // A genuinely terrible server that also hard-fails must stay terrible.
    // Math.min, not assignment.
    const bad = { score: 5, max_score: 91 };
    const g = grade(input({
      static: {
        ...baseStatic, ...bad, pct: staticPct(bad),
        hard_fail: 'transport is not TLS-encrypted',
      },
      probes: [probe('cold_open', 0), probe('bad_input', 0)],
    }));
    expect(g.score).toBeLessThan(HARD_FAIL_CEILING);
  });

  it('reports every hard fail, not just the first', () => {
    const inj: ProbeResult = {
      probe_id: 'injection_sniff', applicable: true, runs: [], score: 0,
      failure_modes: [], hard_fail: 'injection-shaped content in 1 location(s)',
    };
    const g = grade(input({
      static: { ...baseStatic, pct: 85.71, hard_fail: 'transport is not TLS-encrypted' },
      probes: [inj],
    }));
    expect(g.hard_fail).toContain('TLS');
    expect(g.hard_fail).toContain('injection');
  });
});

describe('worst failure modes', () => {
  it('puts hard fails first, then the worst probe, then severity order', () => {
    const modes = worstFailureModes(input({
      static: {
        ...baseStatic, pct: 85.71, hard_fail: 'transport is not TLS-encrypted',
        failed_rules: [
          { rule_id: 'low_thing', severity: 'LOW', message: 'minor' },
          { rule_id: 'crit_thing', severity: 'CRITICAL', message: 'major' },
        ],
      },
      probes: [
        { ...probe('cold_open', 20), failure_modes: ['agent picked the wrong tool'] },
        { ...probe('bad_input', 90), failure_modes: ['error was vague'] },
      ],
    }));
    expect(modes[0]).toContain('HARD FAIL');
    expect(modes[1]).toBe('agent picked the wrong tool');
    expect(modes).toHaveLength(3);
  });

  it('caps at three', () => {
    const modes = worstFailureModes(input({
      static: {
        ...baseStatic, pct: 85.71,
        failed_rules: Array.from({ length: 10 }, (_, i) => ({
          rule_id: 'r' + i, severity: 'HIGH', message: 'm' + i,
        })),
      },
    }));
    expect(modes).toHaveLength(3);
  });
});

describe('end-to-end grade shape', () => {
  it('carries the pinned model, because the grade is relative to it', () => {
    const g = grade(input({ model: 'claude-sonnet-5' }));
    expect(g.model).toBe('claude-sonnet-5');
    expect(g.mcpscore_version).toBe('1.11.0');
  });

  it('records a null probe score for a skipped probe', () => {
    const g = grade(input({
      probes: [probe('cold_open', 80), probe('chain', null, false)],
    }));
    expect(g.probe_scores.chain).toBeNull();
    expect(g.probe_scores.cold_open).toBe(80);
  });
});
