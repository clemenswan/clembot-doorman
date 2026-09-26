/**
 * The authority routes.
 *
 * The failure that matters here is not a 500. It is a malformed query
 * returning zero cards, because "no cards" and "nothing wrong in that
 * dimension" read identically to the dashboard and to the person looking at
 * it. Several tests below exist only to pin that distinction.
 */

import { describe, expect, it } from 'vitest';
import { handlePatterns, handleProfile, parseDims, parseIds } from '../src/routes/patterns.js';
import { NEVER_PAID, PAID_ROUTES } from '../src/routes/payment.js';
import type { Env } from '../src/index.js';

function fakeDb(rows: Record<string, unknown>[] | Error, first: Record<string, unknown> | null = null) {
  const calls: { sql: string; args: unknown[] }[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const call = { sql, args: [] as unknown[] };
        calls.push(call);
        return {
          bind(...args: unknown[]) { call.args = args; return this; },
          async all<T>() {
            if (rows instanceof Error) throw rows;
            return { results: rows as T[] };
          },
          async first() {
            if (rows instanceof Error) throw rows;
            return first;
          },
        };
      },
    },
  } as unknown as Env;
  return { env, calls };
}

const card = (over: Record<string, unknown> = {}) => ({
  id: 'perm-explicit',
  dimension: 1,
  title: 'Declare permissions explicitly',
  why: 'Because.',
  fix: 'Add a permissions block.',
  effort: 'S',
  evidence_url: 'https://github.com/clemenswan/clembot-doorman',
  graded_mcps: '[]',
  updated_at: '2026-09-22T00:00:00.000Z',
  ...over,
});

describe('parseDims', () => {
  it('parses a clean list', () => expect(parseDims('2,4')).toEqual([2, 4]));
  it('sorts and dedupes', () => expect(parseDims('4,2,4')).toEqual([2, 4]));
  it('drops out-of-range values', () => expect(parseDims('0,8,3')).toEqual([3]));
  it('tolerates whitespace', () => expect(parseDims(' 2 , 3 ')).toEqual([2, 3]));

  // The load-bearing one. An unparseable filter must mean NO filter, never an
  // empty result: a dimension with nothing wrong looks exactly the same.
  it('yields no filter rather than no results on garbage', () => {
    expect(parseDims('banana')).toEqual([]);
    expect(parseDims('')).toEqual([]);
    expect(parseDims(null)).toEqual([]);
  });
});

describe('parseIds', () => {
  it('accepts rubric-shaped ids', () => expect(parseIds('perm-explicit,mem-handoff'))
    .toEqual(['mem-handoff', 'perm-explicit']));
  it('rejects anything that is not an id', () => expect(parseIds("a';DROP TABLE patterns;--"))
    .toEqual([]));
  it('is empty for no input', () => expect(parseIds(null)).toEqual([]));
});

describe('GET /patterns', () => {
  it('returns every card with no filter', async () => {
    const { env, calls } = fakeDb([card(), card({ id: 'mem-handoff', dimension: 6 })]);
    const r = await handlePatterns(new URL('https://x.test/patterns'), env);
    const body = await r.json() as { count: number; patterns: unknown[] };
    expect(r.status).toBe(200);
    expect(body.count).toBe(2);
    expect(calls[0].sql).not.toContain('WHERE');
  });

  it('filters by dimension with bound parameters', async () => {
    const { env, calls } = fakeDb([card()]);
    await handlePatterns(new URL('https://x.test/patterns?dims=1,4'), env);
    expect(calls[0].sql).toContain('dimension IN (?,?)');
    expect(calls[0].args).toEqual([1, 4]);
  });

  it('filters by id', async () => {
    const { env, calls } = fakeDb([card()]);
    await handlePatterns(new URL('https://x.test/patterns?ids=perm-explicit'), env);
    expect(calls[0].sql).toContain('id IN (?)');
    expect(calls[0].args).toEqual(['perm-explicit']);
  });

  it('combines both filters', async () => {
    const { env, calls } = fakeDb([card()]);
    await handlePatterns(new URL('https://x.test/patterns?dims=1&ids=perm-explicit'), env);
    expect(calls[0].sql).toContain('dimension IN (?)');
    expect(calls[0].sql).toContain('id IN (?)');
    expect(calls[0].args).toEqual([1, 'perm-explicit']);
  });

  // The query is never interpolated, so an id that escaped parseIds still
  // could not reach the SQL. Asserted rather than assumed.
  it('never interpolates a filter value into the SQL', async () => {
    const { env, calls } = fakeDb([]);
    await handlePatterns(new URL("https://x.test/patterns?ids=a';DROP+TABLE+patterns;--"), env);
    expect(calls[0].sql).not.toContain('DROP');
    expect(calls[0].args).toEqual([]);
  });

  it('parses graded_mcps into an array', async () => {
    const { env } = fakeDb([card({ graded_mcps: '["https://mcp.exa.ai/mcp"]' })]);
    const body = await (await handlePatterns(new URL('https://x.test/patterns'), env)).json() as
      { patterns: { graded_mcps: string[] }[] };
    expect(body.patterns[0].graded_mcps).toEqual(['https://mcp.exa.ai/mcp']);
  });

  it('survives a row whose graded_mcps will not parse', async () => {
    const { env } = fakeDb([card({ graded_mcps: 'not json' })]);
    const r = await handlePatterns(new URL('https://x.test/patterns'), env);
    const body = await r.json() as { patterns: { graded_mcps: string[] }[] };
    expect(r.status).toBe(200);
    expect(body.patterns[0].graded_mcps).toEqual([]);
  });

  it('serves an empty labelled result when the table is not migrated', async () => {
    const { env } = fakeDb(new Error('no such table: patterns'));
    const r = await handlePatterns(new URL('https://x.test/patterns'), env);
    const body = await r.json() as { count: number; note: string };
    expect(r.status).toBe(200);
    expect(body.count).toBe(0);
    expect(body.note).toContain('not migrated');
  });
});

describe('GET /profiles/:name', () => {
  it('404s when nothing is published, and says why', async () => {
    const { env } = fakeDb([], null);
    const r = await handleProfile('clembot', env);
    const body = await r.json() as { note: string };
    expect(r.status).toBe(404);
    expect(body.note).toContain('bundled');
  });

  it('serves a published profile', async () => {
    const { env } = fakeDb([], {
      name: 'clembot', body: '{"letter":"A"}', version: 1, updated_at: '2026-09-22T00:00:00.000Z',
    });
    const r = await handleProfile('clembot', env);
    const body = await r.json() as { profile: { letter: string } };
    expect(r.status).toBe(200);
    expect(body.profile.letter).toBe('A');
  });

  it('rejects a name that is not a name', async () => {
    const { env } = fakeDb([], null);
    expect((await handleProfile('../../etc/passwd', env)).status).toBe(400);
  });
});

describe('the authority is free', () => {
  // Invariant 22 applied one route over. A finding you have to pay to read is
  // a finding you cannot act on.
  it('patterns and profiles are on the never-paid list', () => {
    expect(NEVER_PAID).toContain('/patterns');
    expect(NEVER_PAID).toContain('/profiles/:name');
  });

  it('and are not on the paid list', () => {
    const paid = new Set(PAID_ROUTES.map((r) => r.path));
    expect(paid.has('/patterns')).toBe(false);
    expect(paid.has('/profiles/:name')).toBe(false);
  });
});
