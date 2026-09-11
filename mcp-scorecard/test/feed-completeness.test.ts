/**
 * Supersede semantics: a cheaper re-grade must not silently replace a fuller
 * audit.
 *
 * THE BUG THIS PINS, observed live on 2026-09-11. deepwiki was graded across
 * all three layers, then re-graded `--static-only` four times. The feed takes
 * MAX(completed_at) per server, so the one-layer run won the row, and the
 * LETTER did not move: A before, A after. Weights renormalising over the
 * layers that ran is invariant 3 behaving correctly, and it is exactly what
 * makes the swap invisible, because an A resting on 30 points of rubric and an
 * A resting on 100 print identically.
 *
 * The fix is not to promote the older audit. A fresh scan-only run needs no
 * model and can cap a grade at F on its own, so the newest must keep the row
 * or real bad news gets suppressed. The fix is to stop hiding the difference.
 */

import { describe, it, expect } from 'vitest';
import { handleFeed, layersMeasured } from '../src/routes/feed.js';
import type { Env } from '../src/index.js';

type Row = Record<string, unknown>;

const DEEPWIKI = 'https://mcp.deepwiki.com/mcp';

/** The complete audit that ran, and was then superseded. */
const COMPLETE = {
  server_url: DEEPWIKI, audit_id: 'aud-complete', id: 'aud-complete',
  grade: 'A', score: 91.59,
  static_pct: 85.71, behavioral_pct: 91.75, guidance_pct: 100,
  model: 'gemini-3.5-flash-lite', completed_at: '2026-09-11T18:00:00Z',
  server_name: 'deepwiki', hard_fail: null, mcpscore_version: '1.11.0',
};

/** The cheap re-run that took its place. */
const STATIC_ONLY = {
  server_url: DEEPWIKI, audit_id: 'aud-static', id: 'aud-static',
  grade: 'A', score: 85.71,
  static_pct: 85.71, behavioral_pct: null, guidance_pct: null,
  model: null, completed_at: '2026-09-11T18:19:34Z',
  server_name: 'deepwiki', hard_fail: null, mcpscore_version: '1.11.0',
};

/**
 * Routes by query. The `audits` feed query and the completeness query hit the
 * same table, so they are told apart by the window function the second one uses.
 */
function fakeDb(newest: Row[], best: Row[], opts: { fullerThrows?: boolean } = {}) {
  return {
    DB: {
      prepare(sql: string) {
        const isPop = sql.includes('FROM popularity');
        const isBest = sql.includes('ROW_NUMBER() OVER');
        return {
          bind() { return this; },
          async all<T>() {
            if (isPop) return { results: [] as T[] };
            if (isBest) {
              if (opts.fullerThrows) throw new Error('no such function: ROW_NUMBER');
              return { results: best as T[] };
            }
            return { results: newest as T[] };
          },
        };
      },
    },
  } as unknown as Env;
}

async function feed(env: Env) {
  const res = await handleFeed(new URL('https://scorecard.example/feed'), env);
  return await res.json() as {
    completeness_note: string;
    candidates: Array<{
      server_url: string; grade: string | null; score: number | null;
      layers_measured: number;
      more_complete_audit: null | {
        audit_id: string; score: number | null; layers_measured: number;
        model: string | null; graded_at: string | null; transcripts: string;
      };
    }>;
  };
}

const withLayers = (r: Row, layers: number) => ({ ...r, layers });

describe('layersMeasured', () => {
  it('counts only layers that were actually measured', () => {
    expect(layersMeasured(COMPLETE)).toBe(3);
    expect(layersMeasured(STATIC_ONLY)).toBe(1);
  });

  it('does not count a zero as unmeasured', () => {
    // A layer that scored 0 RAN. Treating it as absent would let a total
    // behavioural failure read as a partial audit.
    expect(layersMeasured({ static_pct: 0, behavioral_pct: 0, guidance_pct: null })).toBe(2);
  });
});

describe('feed completeness', () => {
  it('keeps the NEWEST audit in the row even though it measured less', async () => {
    const body = await feed(fakeDb([STATIC_ONLY], [withLayers(COMPLETE, 3)]));
    expect(body.candidates[0].score).toBe(85.71);
    expect(body.candidates[0].layers_measured).toBe(1);
  });

  it('names the fuller audit that the cheap re-grade displaced', async () => {
    const body = await feed(fakeDb([STATIC_ONLY], [withLayers(COMPLETE, 3)]));
    const m = body.candidates[0].more_complete_audit;
    expect(m).not.toBeNull();
    expect(m?.audit_id).toBe('aud-complete');
    expect(m?.layers_measured).toBe(3);
    expect(m?.score).toBe(91.59);
  });

  it('carries the fuller audit MODEL and date, because a grade is relative to both', async () => {
    const body = await feed(fakeDb([STATIC_ONLY], [withLayers(COMPLETE, 3)]));
    const m = body.candidates[0].more_complete_audit;
    expect(m?.model).toBe('gemini-3.5-flash-lite');
    expect(m?.graded_at).toBe('2026-09-11T18:00:00Z');
    // And its evidence is reachable, or the pointer is just a rumour.
    expect(m?.transcripts).toContain('/grade/aud-complete/transcripts');
  });

  it('is null when the newest audit IS the fullest', async () => {
    const body = await feed(fakeDb([COMPLETE], [withLayers(COMPLETE, 3)]));
    expect(body.candidates[0].more_complete_audit).toBeNull();
    expect(body.candidates[0].layers_measured).toBe(3);
  });

  it('is null when an older audit measured the SAME amount, not more', async () => {
    // Equal coverage is a re-grade, not a fuller measurement. Pointing at it
    // would put a stale duplicate beside every routinely re-graded server.
    const older = { ...STATIC_ONLY, audit_id: 'aud-older', id: 'aud-older', completed_at: '2026-09-01T00:00:00Z' };
    const body = await feed(fakeDb([STATIC_ONLY], [withLayers(older, 1)]));
    expect(body.candidates[0].more_complete_audit).toBeNull();
  });

  it('reports layers from the RETURNED COLUMNS, not from a count done in SQL', async () => {
    // The ranking query counts layers in SQL to order rows; the decision to
    // publish a pointer counts them in TS from the columns. If the pointer
    // ever echoed the SQL count, a divergence between the two would be
    // invisible. Here the SQL count is deliberately wrong (99) and the
    // reported value must still be the truth about the columns: 3.
    const body = await feed(fakeDb([STATIC_ONLY], [withLayers(COMPLETE, 99)]));
    expect(body.candidates[0].more_complete_audit?.layers_measured).toBe(3);
  });

  it('suppresses the pointer when the columns say equal, whatever SQL ranked', async () => {
    // Same guard from the other side: a SQL count claiming the older audit is
    // fuller must not publish a pointer when its columns say otherwise.
    const older = { ...STATIC_ONLY, audit_id: 'aud-older', id: 'aud-older', completed_at: '2026-09-01T00:00:00Z' };
    const body = await feed(fakeDb([STATIC_ONLY], [withLayers(older, 99)]));
    expect(body.candidates[0].more_complete_audit).toBeNull();
  });

  it('still surfaces a fresh HARD FAIL over an older complete pass', async () => {
    // The reason newest-wins is not negotiable. injection_sniff runs with no
    // model and can cap a grade at F by itself, so the cheap fresh audit is
    // where hostile tool descriptions get caught. Promoting the older A here
    // would suppress the finding that costs nothing to produce.
    const freshF = {
      ...STATIC_ONLY, audit_id: 'aud-f', id: 'aud-f', grade: 'F', score: 49,
      hard_fail: 'prompt injection in tool description',
      completed_at: '2026-09-12T00:00:00Z',
    };
    const body = await feed(fakeDb([freshF], [withLayers(COMPLETE, 3)]));
    expect(body.candidates[0].grade).toBe('F');
    // and the older, better-looking audit is still disclosed rather than hidden
    expect(body.candidates[0].more_complete_audit?.grade).toBe('A');
  });

  it('serves the feed normally if the completeness query fails', async () => {
    const body = await feed(fakeDb([STATIC_ONLY], [], { fullerThrows: true }));
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].more_complete_audit).toBeNull();
    // layers_measured is computed from the row itself, so it survives.
    expect(body.candidates[0].layers_measured).toBe(1);
  });

  it('warns on the wire against comparing the two scores directly', async () => {
    const body = await feed(fakeDb([STATIC_ONLY], [withLayers(COMPLETE, 3)]));
    expect(body.completeness_note).toMatch(/not compare the two scores directly/i);
    expect(body.completeness_note).toMatch(/renormalise/i);
  });
});
