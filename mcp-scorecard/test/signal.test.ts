import { describe, expect, it } from 'vitest';
import {
  MAX_TERMS_PER_REQUEST, VOCABULARY, classify, dayFor, readSignals, recordSignal,
} from '../src/signal.js';

/**
 * The contribution path. `community-signal.md` is the brief.
 *
 * The rules under test are mostly refusals, because the whole value of this
 * endpoint rests on it being safe to turn on. A payload that could carry a
 * prompt, a url, or anything a contributor did not mean to send would make
 * `doorman contribute` a thing nobody should run.
 */

/** A D1 stub that records what it was asked to write. */
function db(rows: Array<Record<string, unknown>> = []) {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      const st = {
        args: [] as unknown[],
        bind(...a: unknown[]) { st.args = a; statements.push({ sql, args: a }); return st; },
        async all() { return { results: rows }; },
        async first() { return rows[0] ?? null; },
        async run() { return { meta: { changes: 1 } }; },
      };
      return st;
    },
    async batch(s: unknown[]) { return s.map(() => ({ meta: { changes: 1 } })); },
  } as unknown as D1Database;
  return { DB, statements };
}

describe('the vocabulary is closed', () => {
  it('accepts every taxonomy id the client can produce', () => {
    const r = classify({ gaps: [...VOCABULARY], blocked: [] });
    expect(r.gaps).toEqual([...VOCABULARY]);
    expect(r.dropped).toEqual([]);
  });

  it('drops an unknown term and says which one', () => {
    const r = classify({ gaps: ['web-search', 'teleportation'], blocked: [] });
    expect(r.gaps).toEqual(['web-search']);
    expect(r.dropped).toEqual([{ value: 'teleportation', why: 'not in the vocabulary' }]);
  });

  it('an entirely unknown payload drops everything rather than throwing', () => {
    // 200 with everything dropped, never a 400. The contributor is running a
    // newer client than this deployment knows about, and refusing the whole
    // request would not tell them which term was the problem.
    const r = classify({ gaps: ['a', 'b'], blocked: [] });
    expect(r.gaps).toEqual([]);
    expect(r.dropped).toHaveLength(2);
  });
});

describe('nothing free-text can get through', () => {
  // The single most important property here. `needs.mjs` promises that the
  // prompts never leave the machine, and invariant 28 is the reason: most
  // `user` records in a transcript directory are tool results and expanded
  // skill bodies. A field that accepted prose would ship those.
  const hostile = [
    'here is my whole prompt about the database password',
    'https://internal.example.com/mcp',
    'name with spaces',
    'name/with/slashes',
    '../../etc/passwd',
    'name\nwith\nnewlines',
    '<script>alert(1)</script>',
  ];

  for (const value of hostile) {
    it(`refuses a blocked name shaped like ${JSON.stringify(value.slice(0, 24))}`, () => {
      const r = classify({ gaps: [], blocked: [value] });
      expect(r.blocked).toEqual([]);
      expect(r.dropped[0].value).toBe(value);
    });
  }

  it('accepts the shape the gate can actually see', () => {
    // The gate reads `mcp__<server>__<tool>`, so the server segment is all it
    // knows, and it is already constrained to this alphabet.
    const r = classify({ gaps: [], blocked: ['claude_ai_Slack', 'plugin-finance-bigquery'] });
    expect(r.blocked).toEqual(['claude_ai_Slack', 'plugin-finance-bigquery']);
    expect(r.dropped).toEqual([]);
  });

  it('refuses a name long enough to be carrying something else', () => {
    const r = classify({ gaps: [], blocked: ['a'.repeat(200)] });
    expect(r.blocked).toEqual([]);
    expect(r.dropped[0].why).toMatch(/too long/);
  });
});

describe('a single caller cannot inflate a count by repeating itself', () => {
  it('deduplicates within one request', () => {
    const r = classify({
      gaps: ['web-search', 'web-search', 'web-search'],
      blocked: ['foo', 'foo'],
    });
    expect(r.gaps).toEqual(['web-search']);
    expect(r.blocked).toEqual(['foo']);
  });

  it('caps how many terms one request may carry', () => {
    const many = Array.from({ length: MAX_TERMS_PER_REQUEST + 10 }, (_, i) => `name${i}`);
    const r = classify({ gaps: [], blocked: many });
    expect(r.blocked.length).toBe(MAX_TERMS_PER_REQUEST);
    expect(r.truncated).toBe(true);
  });

  it('is not truncated when it fits', () => {
    expect(classify({ gaps: ['web-search'], blocked: [] }).truncated).toBe(false);
  });
});

describe('a non-array, a null, a number: none of them throw', () => {
  for (const bad of [null, undefined, 'web-search', 42, {}] as unknown[]) {
    it(`survives gaps = ${JSON.stringify(bad) ?? 'undefined'}`, () => {
      const r = classify({ gaps: bad as string[], blocked: [] });
      expect(r.gaps).toEqual([]);
      expect(r.truncated).toBe(false);
    });
  }

  it('ignores a non-string inside an otherwise valid array', () => {
    const r = classify({ gaps: ['web-search', 7 as unknown as string], blocked: [] });
    expect(r.gaps).toEqual(['web-search']);
    expect(r.dropped).toHaveLength(1);
  });
});

describe('the day bucket', () => {
  it('is a UTC date and nothing finer', () => {
    // Finer than a day is a timing channel over a small population, and
    // nothing downstream needs an hour.
    expect(dayFor(Date.UTC(2026, 8, 22, 23, 59, 59))).toBe('2026-09-22');
    expect(dayFor(Date.UTC(2026, 8, 23, 0, 0, 1))).toBe('2026-09-23');
  });
});

describe('recordSignal writes counts and nothing else', () => {
  it('writes one upsert per accepted term, carrying only kind, term and day', async () => {
    const { DB, statements } = db();
    const counted = await recordSignal(
      { DB } as never,
      { gaps: ['web-search', 'database'], blocked: ['foo'] },
      Date.UTC(2026, 8, 22, 12),
    );

    expect(counted).toEqual({ gaps: 2, blocked: 1 });
    expect(statements).toHaveLength(3);
    for (const s of statements) {
      expect(s.sql).toMatch(/INSERT INTO signal_count/);
      // kind, term, day. Four binds at most, and the fourth is the day again
      // for the conflict clause at worst. Anything longer means a field crept
      // in that this table has no business holding.
      expect(s.args.length).toBeLessThanOrEqual(3);
      expect(s.args.every((a) => typeof a === 'string')).toBe(true);
      expect(s.args).toContain('2026-09-22');
    }
    expect(statements.map((s) => s.args[0]).sort()).toEqual(['blocked', 'gap', 'gap']);
  });

  it('writes nothing at all when everything was dropped', async () => {
    const { DB, statements } = db();
    const counted = await recordSignal({ DB } as never, { gaps: [], blocked: [] }, Date.now());
    expect(counted).toEqual({ gaps: 0, blocked: 0 });
    expect(statements).toEqual([]);
  });
});

describe('readSignals', () => {
  it('reports counts as reports, never as builds', async () => {
    const { DB } = db([
      { kind: 'gap', term: 'web-search', reports: 23, first_seen: '2026-09-14' },
      { kind: 'blocked', term: 'foo', reports: 9, first_seen: '2026-09-18' },
    ]);
    const r = await readSignals({ DB } as never);

    expect(r.gaps[0]).toEqual({ term: 'web-search', reports: 23, first_seen: '2026-09-14' });
    expect(r.blocked[0]).toEqual({ term: 'foo', reports: 9, first_seen: '2026-09-18' });
    // Nothing here knows who is asking, so nothing here can count builds.
    expect(JSON.stringify(r)).not.toMatch(/"builds"/);
    expect(r.note).toMatch(/Reports, not installs/);
  });

  it('publishes the vocabulary, so a client can see what this deployment knows', async () => {
    const { DB } = db([]);
    const r = await readSignals({ DB } as never);
    expect(r.vocabulary).toEqual([...VOCABULARY]);
    expect(r.gaps).toEqual([]);
  });

  it('an unreadable table is an error, never an empty community', async () => {
    // Invariant 3. Zero reports and a broken query look identical in a list,
    // and one of them means "nobody needs anything".
    const broken = {
      DB: {
        prepare() {
          return { bind() { return this; }, async all() { throw new Error('D1 down'); } };
        },
      } as unknown as D1Database,
    };
    await expect(readSignals(broken as never)).rejects.toThrow(/D1 down/);
  });
});
