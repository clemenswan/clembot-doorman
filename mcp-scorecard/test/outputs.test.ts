import { describe, expect, it } from 'vitest';
import { MAX_REPORT_LINES, buildReport } from '../src/outputs/report.js';
import { buildRecipe, deriveRules } from '../src/outputs/recipe.js';
import { buildBadge, buildUnknownBadge } from '../src/outputs/badge.js';
import {
  anchor, canonicalJson, hashBundle, sha256Hex, transcriptsToJsonl,
  type EvidenceBundle,
} from '../src/outputs/evidence.js';
import { grade, staticPct } from '../src/grade/grade.js';
import type { GradeInput, ProbeResult, StaticLayer } from '../src/grade/types.js';

const st: StaticLayer = {
  score: 78, max_score: 91, pct: staticPct({ score: 78, max_score: 91 }),
  mcpscore_version: '1.11.0',
  failed_rules: [
    { rule_id: 'tools_annotations_present', severity: 'MEDIUM', message: 'no annotations' },
  ],
};

function probes(): ProbeResult[] {
  return [
    {
      probe_id: 'cold_open', applicable: true, score: 55,
      runs: [{
        run_index: 0, score: 55, signals: {},
        transcript: [
          { ts: '2026-09-01T00:00:00Z', role: 'user', content: 'do the thing' },
          { ts: '2026-09-01T00:00:01Z', role: 'tool_call', content: { name: 'search' } },
        ],
      }],
      failure_modes: ["agent reached for 'search' when 'lookup' was the fit"],
    },
    {
      probe_id: 'bad_input', applicable: true, score: 45, runs: [],
      failure_modes: ["error for missing 'repoName' does not name the field"],
    },
    {
      probe_id: 'chain', applicable: false, skip_reason: 'only 2 tools',
      runs: [], score: null, failure_modes: [],
    },
  ];
}

function gi(over: Partial<GradeInput> = {}): GradeInput {
  return {
    server_url: 'https://example.test/mcp',
    model: 'claude-sonnet-5',
    static: st, probes: probes(), guidance: null, ...over,
  };
}

describe('report.md is capped at one page', () => {
  it('fits within the line budget for a normal audit', () => {
    const g = grade(gi());
    const md = buildReport({ grade: g, probes: probes(), audit_id: 'aud_1' });
    expect(md.split('\n').length).toBeLessThanOrEqual(MAX_REPORT_LINES);
  });

  it('still fits when every failure mode is absurdly long', () => {
    const long = 'x'.repeat(4000);
    const g = grade(gi({
      probes: [
        { probe_id: 'cold_open', applicable: true, score: 10, runs: [],
          failure_modes: [long, long, long] },
      ],
    }));
    const md = buildReport({ grade: g, probes: probes(), audit_id: 'aud_2' });
    const lines = md.split('\n');
    expect(lines.length).toBeLessThanOrEqual(MAX_REPORT_LINES);
    // No single line may blow the width either, or "one page" is a fiction.
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(200);
  });

  it('shows the hard fail prominently when there is one', () => {
    const g = grade(gi({ static: { ...st, hard_fail: 'transport is not TLS-encrypted' } }));
    const md = buildReport({ grade: g, probes: probes(), audit_id: 'aud_3' });
    expect(md).toContain('HARD FAIL');
    expect(md).toContain('Grade F');
  });

  it('always carries the model, because the grade is relative to it', () => {
    const g = grade(gi());
    const md = buildReport({ grade: g, probes: probes(), audit_id: 'aud_4' });
    expect(md).toContain('claude-sonnet-5');
    expect(md).toContain('Provenance');
  });

  it('marks an unmeasured layer as not measured rather than zero', () => {
    const g = grade(gi({ guidance: null }));
    const md = buildReport({ grade: g, probes: probes(), audit_id: 'aud_5' });
    expect(md).toContain('_not measured_');
  });
});

describe('recipe.md is derived, never invented', () => {
  it('writes a rule naming the tool that should have been picked', () => {
    const g = grade(gi());
    const md = buildRecipe({ grade: g, probes: probes() });
    expect(md).toContain('`lookup`');
    expect(md).toContain('`search`');
    expect(md).toContain('cold_open');
  });

  it('writes no rules at all when nothing failed', () => {
    const clean: ProbeResult[] = [
      { probe_id: 'cold_open', applicable: true, score: 100, runs: [], failure_modes: [] },
      { probe_id: 'bad_input', applicable: true, score: 100, runs: [], failure_modes: [] },
    ];
    const g = grade(gi({ probes: clean }));
    const rules = deriveRules({ grade: g, probes: clean });
    expect(rules).toHaveLength(0);
    expect(buildRecipe({ grade: g, probes: clean })).toContain('No failure modes were observed');
  });

  it('traces every rule to the probe that produced it', () => {
    const g = grade(gi());
    for (const r of deriveRules({ grade: g, probes: probes() })) {
      expect(r.from).toBeTruthy();
      expect(r.because).toBeTruthy();
    }
  });

  it('leads with a do-not-use warning on a hard fail', () => {
    const inj: ProbeResult = {
      probe_id: 'injection_sniff', applicable: true, score: 0, runs: [],
      failure_modes: ['injection-shaped content in tool:x.description'],
      hard_fail: 'injection-shaped content in 1 location(s): tool:x.description',
    };
    const p = [...probes(), inj];
    const g = grade(gi({ probes: p }));
    const md = buildRecipe({ grade: g, probes: p });
    expect(md).toContain('Do not use this server');
    expect(deriveRules({ grade: g, probes: p })[0].from).toBe('injection_sniff');
  });

  it('does not write a rule for a probe that was skipped', () => {
    const g = grade(gi());
    const rules = deriveRules({ grade: g, probes: probes() });
    expect(rules.every((r) => r.from !== 'chain')).toBe(true);
  });
});

describe('badge', () => {
  it('carries the band, score, model and date', () => {
    const svg = buildBadge({
      band: 'B', score: 74, model: 'claude-sonnet-5', graded_at: '2026-09-01T12:00:00Z',
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('B 74');
    expect(svg).toContain('sonnet-5');
    expect(svg).toContain('2026-09-01');
  });

  it('says hard fail on the face of the badge', () => {
    const svg = buildBadge({
      band: 'F', score: 49, model: 'claude-sonnet-5',
      graded_at: '2026-09-01T12:00:00Z', hard_fail: true,
    });
    expect(svg).toContain('hard fail');
  });

  it('escapes text rather than emitting broken XML', () => {
    const svg = buildBadge({
      band: 'A', score: 90, model: 'a<b>&"c', graded_at: '2026-09-01T12:00:00Z',
    });
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;');
  });

  it('has an ungraded badge that does not pretend to be a grade', () => {
    const svg = buildUnknownBadge();
    expect(svg).toContain('ungraded');
    expect(svg).not.toMatch(/>[ABCF]</);
  });
});

describe('evidence hashing', () => {
  const bundle: EvidenceBundle = {
    audit_id: 'aud_1',
    server_url: 'https://example.test/mcp',
    grade: grade(gi()),
    probes: probes(),
    report_md: '# r',
    recipe_md: '# c',
  };

  it('produces a 64-char hex sha-256', async () => {
    const h = await hashBundle(bundle);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across key insertion order', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    // Plain stringify would NOT agree, which is the reason canonicalJson exists.
    expect(JSON.stringify({ b: 1, a: 2 })).not.toBe(JSON.stringify({ a: 2, b: 1 }));
  });

  it('changes when a transcript changes, so evidence cannot be edited', async () => {
    const before = await hashBundle(bundle);
    const tampered: EvidenceBundle = {
      ...bundle,
      probes: bundle.probes.map((p) =>
        p.probe_id === 'cold_open'
          ? {
              ...p,
              runs: p.runs.map((r) => ({
                ...r,
                transcript: [...r.transcript.slice(0, 1)], // drop a turn
              })),
            }
          : p,
      ),
    };
    expect(await hashBundle(tampered)).not.toBe(before);
  });

  it('changes when the grade changes', async () => {
    const before = await hashBundle(bundle);
    const after = await hashBundle({
      ...bundle,
      grade: { ...bundle.grade, score: bundle.grade.score + 1 },
    });
    expect(after).not.toBe(before);
  });

  it('hashes a known string to the known digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('transcripts', () => {
  it('emits one JSONL line per turn, in order, with no truncation', () => {
    const jsonl = transcriptsToJsonl(probes());
    const lines = jsonl.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.probe_id).toBe('cold_open');
    expect(first.run_index).toBe(0);
    expect(first.role).toBe('user');
    expect(first.content).toBe('do the thing');
  });
});

describe('anchor stub', () => {
  it('never claims to have anchored anything', async () => {
    const logs: string[] = [];
    const r = await anchor('deadbeef', { log: (m) => logs.push(m) });
    expect(r.anchored).toBe(false);
    expect(r.tx).toBeNull();
    expect(r.note).toContain('STUB');
    expect(logs[0]).toContain('deadbeef');
  });
});

describe('provenance tells the truth about what ran', () => {
  it('does not claim probe runs on a static-only audit', () => {
    const g = grade(gi({ probes: [] }));
    const md = buildReport({ grade: g, probes: [], audit_id: 'aud_static' });
    expect(md).toContain('no behavioural probes were run');
    expect(md).not.toMatch(/3 run\(s\) each/);
  });

  it('reports the real run count when probes did run', () => {
    const withRuns: ProbeResult[] = [{
      probe_id: 'cold_open', applicable: true, score: 70,
      runs: [0, 1, 2].map((n) => ({ run_index: n, score: 70, signals: {}, transcript: [] })),
      failure_modes: [],
    }];
    const g = grade(gi({ probes: withRuns }));
    const md = buildReport({ grade: g, probes: withRuns, audit_id: 'aud_p' });
    expect(md).toContain('3 run(s) each');
    expect(md).toContain('claude-sonnet-5');
  });

  it('does not name a model when only the scan-only probe ran', () => {
    // The regression this pins: injection_sniff runs without a key, so a
    // static-only audit now has one probe with one run. Counting it as a
    // behavioural probe would print "1 probe(s), 1 run(s) each, model
    // claude-sonnet-5", which is a false provenance claim on an evidence
    // document. No model was called.
    const sniff: ProbeResult[] = [{
      probe_id: 'injection_sniff', applicable: true, score: 0,
      runs: [{ run_index: 0, score: 0, signals: { scan_only: true }, transcript: [] }],
      failure_modes: ['injection-shaped content in tool:search.description'],
      hard_fail: 'injection-shaped content in 1 location(s): tool:search.description',
    }];
    const g = grade(gi({ probes: sniff }));
    const md = buildReport({ grade: g, probes: sniff, audit_id: 'aud_sniff' });

    expect(md).toContain('no behavioural probes were run');
    expect(md).toContain('scan-only: no model, no tool call');
    expect(md).not.toContain('claude-sonnet-5');
    expect(md).not.toMatch(/1 run\(s\) each/);
  });

  it('still names the model when a behavioural probe ran alongside the scan', () => {
    const mixed: ProbeResult[] = [
      {
        probe_id: 'injection_sniff', applicable: true, score: 100,
        runs: [{ run_index: 0, score: 100, signals: {}, transcript: [] }],
        failure_modes: [],
      },
      {
        probe_id: 'cold_open', applicable: true, score: 70,
        runs: [0, 1, 2].map((n) => ({ run_index: n, score: 70, signals: {}, transcript: [] })),
        failure_modes: [],
      },
    ];
    const g = grade(gi({ probes: mixed }));
    const md = buildReport({ grade: g, probes: mixed, audit_id: 'aud_mix' });

    expect(md).toContain('1 behavioural probe(s), 3 run(s) each');
    expect(md).toContain('claude-sonnet-5');
    expect(md).toContain('scan-only');
  });

  it('names why a probe was skipped instead of leaving it blank', () => {
    const g = grade(gi());
    const md = buildReport({ grade: g, probes: probes(), audit_id: 'aud_s' });
    expect(md).toContain('only 2 tools');
  });
});
