import { describe, expect, it } from 'vitest';
import { describeSweep, popularityPosture, sweepPopularity } from '../src/popularity-sweep.js';

/**
 * The production ledger read `0 observed, 0 pruned` on seven consecutive days.
 *
 * That line is true when every source refused AND when there was nothing to
 * ask about, and those need opposite actions: go and look at the sources,
 * versus load the mappings. It was the second. `popularity_subject` is empty,
 * `popularity-subjects.json` was never pushed through `runner/link.mjs`, and
 * the sweep was working perfectly on no input.
 *
 * Invariant 3, one more time: an unmeasured axis is not a measured zero.
 */

/** A D1 stub with a controllable subject table. */
function db(subjects: Array<{ server_key: string; source: string; subject: string }>,
            lastLedger?: { detail: string; created_at: string }) {
  const writes: unknown[] = [];
  return {
    writes,
    DB: {
      prepare(sql: string) {
        return {
          bind() { return this; },
          async all() { return { results: subjects }; },
          async first() {
            if (sql.includes('COUNT(*)')) return { n: subjects.length };
            if (sql.includes("event = 'popularity'")) return lastLedger ?? null;
            return null;
          },
          async run() { return { meta: { changes: 0 } }; },
        };
      },
      async batch(s: unknown[]) { writes.push(...s); return []; },
    } as unknown as D1Database,
  };
}

const neverCalled = (() => {
  throw new Error('the sweep fetched something when it had no subjects');
}) as unknown as typeof fetch;

describe('a sweep with nothing mapped', () => {
  it('reports the subject count, so zero-observed can be explained', async () => {
    const r = await sweepPopularity(db([]) as never, neverCalled);
    expect(r.subjects).toBe(0);
    expect(r.observed).toBe(0);
    expect(r.failed).toEqual({});
  });

  it('does not fetch anything at all', async () => {
    // `neverCalled` throws. Reaching a source with no subjects would be a
    // different bug wearing the same ledger line.
    await expect(sweepPopularity(db([]) as never, neverCalled)).resolves.toBeDefined();
  });
});

describe('describeSweep tells the two zeroes apart', () => {
  it('no subjects says so, and names the command that fixes it', () => {
    const line = describeSweep({ observed: 0, failed: {}, pruned: 0, subjects: 0 });
    expect(line).toMatch(/no subjects mapped/);
    expect(line).toMatch(/link\.mjs/);
    expect(line).not.toMatch(/^0 observed/);
  });

  it('subjects that all failed reads completely differently', () => {
    const line = describeSweep({ observed: 0, failed: { github: 12 }, pruned: 0, subjects: 12 });
    expect(line).toMatch(/12 subjects/);
    expect(line).toMatch(/"github":12/);
    expect(line).not.toMatch(/no subjects mapped/);
  });

  it('a healthy sweep still reports plainly', () => {
    expect(describeSweep({ observed: 9, failed: {}, pruned: 3, subjects: 9 }))
      .toBe('9 subjects, 9 observed, 3 pruned');
  });
});

describe('popularityPosture, for /health', () => {
  it('names the actionable fact when nothing is mapped', async () => {
    const p = await popularityPosture(
      db([], { detail: '0 observed, 0 pruned', created_at: '2026-09-21T07:00:05.919Z' }) as never,
    );
    expect(p.subjects_mapped).toBe(0);
    expect(p.last_sweep).toBe('2026-09-21T07:00:05.919Z');
    expect(p.note).toMatch(/UNMEASURED rather than zero/);
    expect(p.note).toMatch(/link\.mjs/);
  });

  it('stays quiet once subjects exist', async () => {
    const p = await popularityPosture(
      db([{ server_key: 'a', source: 'npm', subject: 'pkg' }]) as never,
    );
    expect(p.subjects_mapped).toBe(1);
    expect(p.note).toBeNull();
  });

  it('an unreadable table is unknown, not zero', async () => {
    const broken = {
      DB: {
        prepare() {
          return { bind() { return this; }, async first() { throw new Error('D1 unavailable'); } };
        },
      } as unknown as D1Database,
    };
    const p = await popularityPosture(broken as never);
    expect(p.subjects_mapped).toBeNull();
    expect(p.note).toBeNull();
  });
});

describe('a sweep WITH subjects counts them', () => {
  // The mutant that made `subjects` always 0 passed every test above, because
  // every one of them swept an empty table. A count is only proven by a case
  // where the right answer is not zero.
  const okFetch = (async (url: string) => ({
    ok: true,
    async json() {
      return String(url).includes('npmjs')
        ? { downloads: 1234 }
        : { stargazers_count: 42 };
    },
  })) as unknown as typeof fetch;

  it('reports the real number of mappings, not zero', async () => {
    const r = await sweepPopularity(
      db([
        { server_key: 'a', source: 'npm', subject: 'pkg-a' },
        { server_key: 'b', source: 'github', subject: 'own/repo' },
      ]) as never,
      okFetch,
    );
    expect(r.subjects).toBe(2);
    expect(r.observed).toBe(2);
    expect(describeSweep(r)).toMatch(/^2 subjects, 2 observed/);
  });

  it('a subject that fails is counted as a subject, not forgotten', async () => {
    const failFetch = (async () => ({ ok: false, async json() { return {}; } })) as unknown as typeof fetch;
    const r = await sweepPopularity(
      db([{ server_key: 'a', source: 'npm', subject: 'pkg-a' }]) as never,
      failFetch,
    );
    expect(r.subjects).toBe(1);
    expect(r.observed).toBe(0);
    expect(r.failed).toEqual({ npm: 1 });
    expect(describeSweep(r)).toMatch(/1 subjects, 0 observed, \{"npm":1\} failed/);
  });
});
