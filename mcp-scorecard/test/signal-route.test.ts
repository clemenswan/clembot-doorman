import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

/**
 * The endpoint, driven rather than grepped.
 *
 * Invariant 31 was written after two mutants survived a first pass: a REST
 * route that ignored its own refusal and an MCP tool that called the limiter
 * and discarded the answer. Both passed a test that grepped for the call site.
 * So every test here goes through `worker.fetch`.
 */

interface Row { kind: string; term: string; reports: number; first_seen: string }

function env(opts: { rows?: Row[]; limiterDown?: boolean; used?: number } = {}) {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      const st = {
        sql,
        args: [] as unknown[],
        bind(...a: unknown[]) { st.args = a; return st; },
        async all() { return { results: opts.rows ?? [] }; },
        async first() {
          if (opts.limiterDown) throw new Error('D1 unavailable');
          if (sql.includes('rate_limit')) {
            return opts.used === undefined ? null : { window_start: Date.now(), used: opts.used };
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO signal_count')) writes.push({ sql, args: st.args });
          return { meta: { changes: 1 } };
        },
      };
      return st;
    },
    async batch(s: Array<{ sql: string; args: unknown[] }>) {
      // The rate limiter batches through the same DB. Record only what lands
      // in signal_count, or every test here would count the limiter's writes
      // as contributions.
      for (const st of s) {
        if (st.sql.includes('INSERT INTO signal_count')) writes.push({ sql: st.sql, args: st.args });
      }
      return s.map(() => ({ meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  return {
    writes,
    env: { DB, PROBE_MODEL: 'm', PROBE_TEMPERATURE: '0', PROBE_RUNS: '3' } as never,
  };
}

const post = (body: unknown) => new Request('https://s.test/signal', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
  body: JSON.stringify(body),
});

describe('POST /signal', () => {
  it('counts what it accepted and names what it dropped', async () => {
    const e = env();
    const res = await worker.fetch(post({ gaps: ['web-search', 'teleportation'], blocked: ['foo'] }), e.env);
    const body = await res.json() as Record<string, never>;

    expect(res.status).toBe(200);
    expect(body.counted).toEqual({ gaps: 1, blocked: 1 });
    expect(body.dropped).toEqual([{ value: 'teleportation', why: 'not in the vocabulary' }]);
    expect(e.writes).toHaveLength(2);
  });

  it('says in the reply that it stored no prompt text, urls or identity', async () => {
    const e = env();
    const body = await (await worker.fetch(post({ gaps: ['database'] }), e.env)).json() as { note: string };
    expect(body.note).toMatch(/No prompt text/i);
  });

  it('a payload of entirely unknown terms is 200 with everything dropped', async () => {
    // Not a 400. The contributor is on a newer client than this deployment.
    const e = env();
    const res = await worker.fetch(post({ gaps: ['teleportation', 'telepathy'] }), e.env);
    const body = await res.json() as Record<string, never>;
    expect(res.status).toBe(200);
    expect(body.counted).toEqual({ gaps: 0, blocked: 0 });
    expect(body.dropped).toHaveLength(2);
    expect(e.writes).toEqual([]);
  });

  it('writes nothing when the payload is empty', async () => {
    const e = env();
    const res = await worker.fetch(post({}), e.env);
    expect(res.status).toBe(200);
    expect(e.writes).toEqual([]);
  });

  it('refuses a body that is not JSON, and writes nothing', async () => {
    const e = env();
    const res = await worker.fetch(new Request('https://s.test/signal', {
      method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' }, body: 'not json',
    }), e.env);
    expect(res.status).toBe(400);
    expect(e.writes).toEqual([]);
  });

  it('never stores a url, even when one is sent as a server name', async () => {
    const e = env();
    const res = await worker.fetch(post({ blocked: ['https://internal.example.com/mcp'] }), e.env);
    const body = await res.json() as Record<string, never>;
    expect(e.writes).toEqual([]);
    expect(body.counted).toEqual({ gaps: 0, blocked: 0 });
  });

  it('is charged through the rate limiter and refuses when the window is full', async () => {
    const e = env({ used: 10_000 });
    const res = await worker.fetch(post({ gaps: ['web-search'] }), e.env);
    expect(res.status).toBe(429);
    expect(e.writes).toEqual([]);
  });

  it('charges even when everything was dropped, so garbage is not free', async () => {
    // At the anonymous ceiling exactly. A request charged 1 is refused; a
    // request charged 0 would sail through, which is how "reject the term and
    // move on" turns into an unmetered endpoint.
    const e = env({ used: 20 });
    const res = await worker.fetch(post({ gaps: ['teleportation'] }), e.env);
    expect(res.status).toBe(429);
  });

  it('fails closed when the limiter cannot be read', async () => {
    // Same reasoning as invariant 31. The resource being protected is the
    // database the check just failed to reach.
    const e = env({ limiterDown: true });
    const res = await worker.fetch(post({ gaps: ['web-search'] }), e.env);
    expect(res.status).toBe(503);
    expect(e.writes).toEqual([]);
  });

  it('is rejected on GET', async () => {
    const e = env();
    const res = await worker.fetch(new Request('https://s.test/signal'), e.env);
    expect(res.status).toBe(404);
  });
});

describe('GET /signals', () => {
  it('is free, unauthenticated, and publishes the vocabulary', async () => {
    const e = env({ rows: [{ kind: 'gap', term: 'web-search', reports: 23, first_seen: '2026-09-14' }] });
    const res = await worker.fetch(new Request('https://s.test/signals'), e.env);
    const body = await res.json() as Record<string, never>;

    expect(res.status).toBe(200);
    expect(body.gaps).toEqual([{ term: 'web-search', reports: 23, first_seen: '2026-09-14' }]);
    expect(Array.isArray(body.vocabulary)).toBe(true);
  });

  it('carries the note that these are reports and touch no grade', async () => {
    const e = env();
    const body = await (await worker.fetch(new Request('https://s.test/signals'), e.env)).json() as { note: string };
    expect(body.note).toMatch(/Reports, not installs/);
    expect(body.note).toMatch(/never evidence about quality/i);
  });
});
