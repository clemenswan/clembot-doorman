import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ANON_ITEMS_PER_WINDOW, GLOBAL_ITEMS_PER_WINDOW, WINDOW_MS,
  admitRequest, decide, enforceRateLimit, identityFor, refusalMessage, windowStartFor,
} from '../src/rate-limit.js';

/**
 * The launch audit of 2026-09-19 found no rate limiting anywhere in `src/` on
 * an endpoint that is anonymous by design (invariant 25) and writes up to ~100
 * D1 rows per request. These are the rules that close it.
 */

const req = (ip?: string) =>
  new Request('https://scorecard.example/grade', {
    method: 'POST',
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  });

/** A D1 stub that actually stores, so a second call sees the first one's charge. */
function memoryDb(opts: { failOn?: 'select' | 'batch' } = {}) {
  const rows = new Map<string, { used: number; window_start: number }>();
  const binding = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      return {
        bind(...args: unknown[]) { bound = args; return this; },
        async first() {
          if (opts.failOn === 'select') throw new Error('D1 unavailable');
          const [key, windowStart] = bound as [string, number];
          const row = rows.get(key);
          return row && row.window_start === windowStart ? row : null;
        },
        get __write() {
          return () => {
            const [key, windowStart, used] = bound as [string, number, number];
            const row = rows.get(key);
            rows.set(key, row && row.window_start === windowStart
              ? { used: row.used + used, window_start: windowStart }
              : { used, window_start: windowStart });
          };
        },
        sql,
      };
    },
    async batch(stmts: Array<{ __write: () => void }>) {
      if (opts.failOn === 'batch') throw new Error('D1 unavailable');
      for (const s of stmts) s.__write();
      return [];
    },
  };
  return { rows, binding: binding as unknown as D1Database };
}

describe('decide: the pure half', () => {
  const base = { used: 0, cost: 1, limit: 10, windowStart: 0, now: 1_000 };

  it('allows up to the limit', () => {
    expect(decide({ ...base, used: 9, cost: 1 }).allowed).toBe(true);
  });

  it('refuses the request that would cross it, not the one after', () => {
    expect(decide({ ...base, used: 10, cost: 1 }).allowed).toBe(false);
  });

  it('refuses a batch WHOLE rather than writing half of it', () => {
    // 15 used, 10 wanted, limit 20. A per-item check would write 5 and refuse 5.
    const d = decide({ ...base, used: 15, cost: 10, limit: 20 });
    expect(d.allowed).toBe(false);
  });

  it('retry-after counts down inside the window and is never zero', () => {
    const early = decide({ ...base, used: 99, limit: 1, now: 1_000 });
    const late = decide({ ...base, used: 99, limit: 1, now: WINDOW_MS - 500 });
    expect(early.retryAfterSec).toBeGreaterThan(late.retryAfterSec);
    expect(late.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
});

describe('windows and identity', () => {
  it('a window is stable inside itself and moves at the boundary', () => {
    expect(windowStartFor(WINDOW_MS + 1)).toBe(windowStartFor(WINDOW_MS + WINDOW_MS - 1));
    expect(windowStartFor(WINDOW_MS * 2)).not.toBe(windowStartFor(WINDOW_MS));
  });

  it('keys on CF-Connecting-IP, and never on a client-settable header', () => {
    const spoofed = new Request('https://scorecard.example/grade', {
      method: 'POST',
      headers: { 'x-forwarded-for': '9.9.9.9', 'cf-connecting-ip': '1.1.1.1' },
    });
    expect(identityFor(spoofed, false)).toContain('1.1.1.1');
    expect(identityFor(spoofed, false)).not.toContain('9.9.9.9');
  });

  it('a request with no IP is charged to a shared bucket, never exempted', () => {
    expect(identityFor(req(), false)).toBe('anon:unknown');
  });

  it('an authed caller gets a different bucket from an anonymous one at the same IP', () => {
    expect(identityFor(req('1.1.1.1'), true)).not.toBe(identityFor(req('1.1.1.1'), false));
  });
});

describe('enforceRateLimit: against a D1 that remembers', () => {
  it('charges items, so one batch can exhaust the window', async () => {
    const db = memoryDb();
    const first = await enforceRateLimit({ DB: db.binding }, req('2.2.2.2'),
      { cost: ANON_ITEMS_PER_WINDOW, authed: false, now: 5_000 });
    expect(first.allowed).toBe(true);

    const second = await enforceRateLimit({ DB: db.binding }, req('2.2.2.2'),
      { cost: 1, authed: false, now: 6_000 });
    expect(second.allowed).toBe(false);
    expect(second.refusedBy).toBe('identity');
  });

  it('a refused request is NOT charged, so retrying cannot push the window out', async () => {
    const db = memoryDb();
    await enforceRateLimit({ DB: db.binding }, req('3.3.3.3'), { cost: ANON_ITEMS_PER_WINDOW, authed: false, now: 1 });
    const before = db.rows.get('anon:3.3.3.3')!.used;
    await enforceRateLimit({ DB: db.binding }, req('3.3.3.3'), { cost: 5, authed: false, now: 2 });
    expect(db.rows.get('anon:3.3.3.3')!.used).toBe(before);
  });

  it('the window rolls, and the old count does not carry', async () => {
    const db = memoryDb();
    await enforceRateLimit({ DB: db.binding }, req('4.4.4.4'), { cost: ANON_ITEMS_PER_WINDOW, authed: false, now: 1_000 });
    const next = await enforceRateLimit({ DB: db.binding }, req('4.4.4.4'),
      { cost: 1, authed: false, now: WINDOW_MS + 1_000 });
    expect(next.allowed).toBe(true);
  });

  it('one caller cannot spend the whole global ceiling on their own', async () => {
    const db = memoryDb();
    // Distinct IPs, each under its own ceiling, summing past the global one.
    let refused = null as string | null;
    for (let i = 0; i < 40 && !refused; i++) {
      const d = await enforceRateLimit({ DB: db.binding }, req(`10.0.0.${i}`),
        { cost: ANON_ITEMS_PER_WINDOW, authed: false, now: 7_000 });
      if (!d.allowed) refused = d.refusedBy;
    }
    expect(refused).toBe('global');
    expect(db.rows.get('global')!.used).toBeLessThanOrEqual(GLOBAL_ITEMS_PER_WINDOW);
  });

  it('an authed caller has room an anonymous one does not', async () => {
    const db = memoryDb();
    const d = await enforceRateLimit({ DB: db.binding }, req('5.5.5.5'),
      { cost: ANON_ITEMS_PER_WINDOW + 1, authed: true, now: 8_000 });
    expect(d.allowed).toBe(true);
  });

  it('FAILS CLOSED when the counter cannot be read', async () => {
    const d = await enforceRateLimit({ DB: memoryDb({ failOn: 'select' }).binding }, req('6.6.6.6'),
      { cost: 1, authed: false, now: 9_000 });
    expect(d.allowed).toBe(false);
    expect(d.refusedBy).toBe('unreadable');
  });

  it('FAILS CLOSED when the charge cannot be written', async () => {
    const d = await enforceRateLimit({ DB: memoryDb({ failOn: 'batch' }).binding }, req('7.7.7.7'),
      { cost: 1, authed: false, now: 9_000 });
    expect(d.allowed).toBe(false);
    expect(d.refusedBy).toBe('unreadable');
  });
});

describe('admitRequest and the message', () => {
  it('hands back an admission carrying what it charged', async () => {
    const r = await admitRequest({ DB: memoryDb().binding }, req('8.8.8.8'), { cost: 3, authed: false, now: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.admission.charged).toBe(3);
  });

  it('the refusal names a number and a wait, and leaks no internals', async () => {
    const db = memoryDb();
    await admitRequest({ DB: db.binding }, req('9.1.1.1'), { cost: ANON_ITEMS_PER_WINDOW, authed: false, now: 10 });
    const r = await admitRequest({ DB: db.binding }, req('9.1.1.1'), { cost: 1, authed: false, now: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const m = refusalMessage(r.decision);
      expect(m).toMatch(/\d+ servers per hour/);
      expect(m).toMatch(/nothing was queued/);
      expect(m).not.toMatch(/D1|SQL|rate_limit|global/i);
    }
  });

  it('an unreadable counter tells the caller it is not their fault', async () => {
    const r = await admitRequest({ DB: memoryDb({ failOn: 'select' }).binding }, req(), { cost: 1, authed: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(refusalMessage(r.decision)).toMatch(/Nothing is wrong with your request/);
  });
});

/**
 * The wiring, asserted structurally.
 *
 * `smoke-x402.mjs` exists because "a gate that is correct and unwired looks
 * exactly like no gate", and invariant 26 is a test that COUNTS a write
 * statement rather than trusting that both callers learned about a new rule.
 * This is the same shape: every file that can reach the queue must also pay the
 * quota, and a third caller added later fails this test rather than shipping a
 * bypass.
 */
describe('the limiter is wired to every path that can queue', () => {
  const dir = fileURLToPath(new URL('../src/routes/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const queuers = files.filter((f) => /\benqueueAudit\(/.test(readFileSync(dir + f, 'utf8')));

  it('finds the callers it expects, so this test cannot pass by finding none', () => {
    expect(queuers.sort()).toEqual(['grade.ts', 'mcp.ts']);
  });

  for (const f of ['grade.ts', 'mcp.ts']) {
    it(`${f} obtains an admission before it queues`, () => {
      expect(readFileSync(dir + f, 'utf8')).toMatch(/admitRequest\(/);
    });
  }

  it('enqueueAudit REQUIRES an admission, so a new caller cannot skip it', () => {
    const src = readFileSync(dir + 'grade.ts', 'utf8');
    // Not optional (`admission?:`) and not defaulted. A required argument is
    // the enforcement; a comment asking nicely is not.
    expect(src).toMatch(/\r?\n\s*admission: Admission,\r?\n/);
    expect(src).not.toMatch(/admission\?:/);
  });
});

/**
 * The route, not the limiter.
 *
 * Every test above proves `enforceRateLimit` decides correctly, and a mutation
 * that made `handleGrade` IGNORE its decision survived all of them: the limiter
 * was right and the endpoint did not care. That is precisely the shape
 * `smoke-x402.mjs` exists to catch one layer up, and it is why these two tests
 * drive the handler itself.
 */
describe('handleGrade refuses when the quota is spent', () => {
  const stored = new Map<string, { used: number; window_start: number }>();
  const binding = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      return {
        sql,
        bind(...args: unknown[]) { bound = args; return this; },
        async first() {
          if (!sql.includes('rate_limit')) return null;
          const [key, ws] = bound as [string, number];
          const row = stored.get(key);
          return row && row.window_start === ws ? row : null;
        },
        get __write() {
          return () => {
            if (!sql.includes('rate_limit')) return;
            const [key, ws, used] = bound as [string, number, number];
            const row = stored.get(key);
            stored.set(key, row && row.window_start === ws
              ? { used: row.used + used, window_start: ws }
              : { used, window_start: ws });
          };
        },
      };
    },
    async batch(stmts: Array<{ __write?: () => void }>) {
      for (const s of stmts) s.__write?.();
      return [];
    },
  } as unknown as D1Database;

  const env = { DB: binding, PROBE_MODEL: 'm', PROBE_TEMPERATURE: '0', PROBE_RUNS: '3' } as never;
  const post = (count: number) =>
    new Request('https://scorecard.example/grade', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify(
        Array.from({ length: count }, (_, i) => ({ url: `https://mcp.example.com/${i}` })),
      ),
    });

  it('serves the first request and then answers 429 with Retry-After', async () => {
    const { handleGrade } = await import('../src/routes/grade.js');

    const first = await handleGrade(post(ANON_ITEMS_PER_WINDOW), env);
    expect(first.status).toBe(202);

    const second = await handleGrade(post(1), env);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);

    const body = await second.json() as { error: string; queued: unknown[] };
    expect(body.queued).toEqual([]);
    expect(body.error).toMatch(/nothing was queued/);
  });

  it('a batch that would CROSS the ceiling queues nothing, not part of itself', async () => {
    stored.clear();
    const { handleGrade } = await import('../src/routes/grade.js');

    // 15 now, then 10 more against a ceiling of 20. A per-item check would
    // write 5 of the second batch and refuse the rest. Note the request cap
    // (20 servers) equals the hourly ceiling, so a single over-size batch is
    // refused by input validation with a 400 and never reaches the limiter.
    expect((await handleGrade(post(15), env)).status).toBe(202);
    const charged = stored.get('anon:203.0.113.7')!.used;

    const res = await handleGrade(post(10), env);
    expect(res.status).toBe(429);
    expect(stored.get('anon:203.0.113.7')!.used).toBe(charged);
  });
});

/**
 * The MCP tool path, driven rather than grepped.
 *
 * Deleting the refusal line from `mcp.ts` passed every test above, including
 * the structural one: the tool still CALLED the limiter, it just ignored the
 * answer. Grepping for a call site proves a call site exists. Only driving it
 * proves the answer is obeyed, which is invariant 26's lesson arriving one
 * more time.
 */
describe('the MCP grade tool obeys the same quota', () => {
  const stored = new Map<string, { used: number; window_start: number }>();
  let queued = 0;
  const binding = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      return {
        sql,
        bind(...args: unknown[]) { bound = args; return this; },
        async first() {
          if (!sql.includes('rate_limit')) return null;   // never graded before
          const [key, ws] = bound as [string, number];
          const row = stored.get(key);
          return row && row.window_start === ws ? row : null;
        },
        get __write() {
          return () => {
            if (sql.includes('INSERT INTO pending')) queued++;
            if (!sql.includes('rate_limit')) return;
            const [key, ws, used] = bound as [string, number, number];
            const row = stored.get(key);
            stored.set(key, row && row.window_start === ws
              ? { used: row.used + used, window_start: ws }
              : { used, window_start: ws });
          };
        },
      };
    },
    async batch(stmts: Array<{ __write?: () => void }>) {
      for (const s of stmts) s.__write?.();
      return [];
    },
  } as unknown as D1Database;

  const env = { DB: binding, PROBE_MODEL: 'm', PROBE_TEMPERATURE: '0', PROBE_RUNS: '3' } as never;
  const call = (n: number) =>
    new Request('https://scorecard.example/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: n, method: 'tools/call',
        params: { name: 'grade', arguments: { url: `https://mcp.example.com/${n}` } },
      }),
    });

  it('queues while there is room, then refuses as a tool error and queues nothing more', async () => {
    const { handleMcp } = await import('../src/routes/mcp.js');

    for (let i = 0; i < ANON_ITEMS_PER_WINDOW; i++) {
      const res = await handleMcp(call(i), env);
      expect(res.status).toBe(200);
    }
    const queuedBeforeRefusal = queued;
    expect(queuedBeforeRefusal).toBeGreaterThan(0);

    const res = await handleMcp(call(999), env);
    const body = await res.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0].text).toMatch(/nothing was queued/);
    expect(queued).toBe(queuedBeforeRefusal);
  });
});
