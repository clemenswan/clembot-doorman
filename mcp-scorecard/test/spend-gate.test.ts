/**
 * The inbound spend permit, and the four ways a half-built one lies.
 *
 *   1. Accepting a token on a deployment that has none configured, which makes
 *      the UNCONFIGURED service the most permissive one.
 *   2. Silently downgrading a caller who presented a wrong token, so a
 *      misconfigured runner produces static-only grades for weeks and nobody
 *      finds out until someone asks where the behavioural layer went.
 *   3. Defaulting the permit to "allowed" somewhere in the chain, so a row
 *      written by code that predates the column can spend.
 *   4. Gating the tape. A grade is an accusation, and the evidence for one
 *      cannot sit behind the accuser's token any more than behind the
 *      accuser's paywall.
 */

import { describe, expect, it } from 'vitest';
import type { Env } from '../src/index.js';
import { NEVER_PAID, PAID_ROUTES } from '../src/routes/payment.js';
import { isSpendGated, paidAllowed, spendPermit } from '../src/routes/spend.js';

const TOKEN = 'grade-token-a3f9c1d4e7b2';

const env = (o: Record<string, string> = {}) =>
  ({ PROBE_MODEL: 'claude-sonnet-5', ...o } as unknown as Env);

const req = (auth?: string) =>
  new Request('https://scorecard.example/grade', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });

describe('spendPermit', () => {
  it('treats no header as anonymous, which is a supported way to call this', () => {
    expect(spendPermit(req(), env({ GRADE_TOKEN: TOKEN }))).toBe('anonymous');
  });

  it('refuses a bare "Bearer" with no token, rather than reading it as anonymous', () => {
    // A deliberate choice, and the first draft of this test got it backwards.
    // HTTP trims the header value, so `Bearer ` arrives as `Bearer` and the
    // scheme prefix no longer matches, which lands it in the comparison and
    // fails it. That is the RIGHT outcome and worth pinning: a client sending
    // this set out to authenticate, so treating it as anonymous would be
    // failure 2, the silent downgrade of a caller who believes otherwise.
    expect(spendPermit(req('Bearer '), env({ GRADE_TOKEN: TOKEN }))).toBe('bad-token');
    expect(spendPermit(req('Bearer'), env({ GRADE_TOKEN: TOKEN }))).toBe('bad-token');
  });

  it('treats a header present but genuinely empty as anonymous', () => {
    // Indistinguishable from no header at all, so it takes the demo path.
    expect(spendPermit(req(''), env({ GRADE_TOKEN: TOKEN }))).toBe('anonymous');
  });

  it('authorises the configured token', () => {
    expect(spendPermit(req(`Bearer ${TOKEN}`), env({ GRADE_TOKEN: TOKEN }))).toBe('authorised');
  });

  it('accepts the token with or without the Bearer prefix', () => {
    expect(spendPermit(req(TOKEN), env({ GRADE_TOKEN: TOKEN }))).toBe('authorised');
  });

  it('rejects a wrong token instead of downgrading it', () => {
    // The loud case. A caller who thinks it is authenticated and is not must
    // find out now, not from a grade that is quietly missing 70 of 100 points.
    expect(spendPermit(req('Bearer wrong'), env({ GRADE_TOKEN: TOKEN }))).toBe('bad-token');
  });

  it('REFUSES a presented token when the deployment configured none', () => {
    // Failure 1. If an unset GRADE_TOKEN accepted anything, the service would
    // be at its most permissive in exactly the state nobody configured.
    expect(spendPermit(req('Bearer anything'), env())).toBe('bad-token');
  });

  it('still lets an unconfigured deployment serve anonymous callers', () => {
    // Unset is a real, supported state: static-only for everyone, which costs
    // nothing. It must not become a wall.
    expect(spendPermit(req(), env())).toBe('anonymous');
  });

  it('does not accept a token that is a prefix of the real one', () => {
    expect(spendPermit(req(`Bearer ${TOKEN.slice(0, -1)}`), env({ GRADE_TOKEN: TOKEN })))
      .toBe('bad-token');
  });
});

describe('paidAllowed', () => {
  it('grants 1 only for an authorised permit', () => {
    expect(paidAllowed('authorised')).toBe(1);
  });

  it('grants 0 for every other verdict', () => {
    // Failure 3, at the one place the value is derived. Anonymous and
    // bad-token must both be 0; there is no third way to reach 1.
    expect(paidAllowed('anonymous')).toBe(0);
    expect(paidAllowed('bad-token')).toBe(0);
  });
});

describe('what is gated', () => {
  it('gates exactly the routes that can cost money, from one list', () => {
    // The spend gate and the paywall must never disagree about which route
    // costs money, so the gate imports PAID_ROUTES rather than restating it.
    expect(PAID_ROUTES).toEqual([{ method: 'POST', path: '/grade' }]);
    expect(isSpendGated('POST', '/grade')).toBe(true);
  });

  it('does not gate reads of a grade', () => {
    expect(isSpendGated('GET', '/grade')).toBe(false);
    expect(isSpendGated('GET', '/grade/abc')).toBe(false);
  });

  it('NEVER gates the tape, the price, or the badge', () => {
    // Failure 4. The tape is the project's load-bearing claim: an accusation
    // whose evidence needs the accuser's permission to read is not evidence.
    for (const route of NEVER_PAID) {
      expect(isSpendGated('GET', route)).toBe(false);
      expect(isSpendGated('POST', route)).toBe(false);
    }
    expect(NEVER_PAID).toContain('/grade/:id/transcripts');
    expect(NEVER_PAID).toContain('/grade/:id');
  });

  it('keeps the free list and the gated list disjoint', () => {
    const gated = new Set(PAID_ROUTES.map((r) => r.path));
    for (const free of NEVER_PAID) expect(gated.has(free)).toBe(false);
  });
});

describe('the migration defaults to the safe direction', () => {
  it('adds paid_allowed with DEFAULT 0, so forgetting the column costs nothing', async () => {
    // Failure 3 again, at the schema. A row written by any code path that does
    // not know about this column must be static-only. Asserting the SQL text is
    // narrow, but the alternative is a live D1 and this is the one property
    // that has to hold before the first real key is ever supplied.
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile(
      new URL('../migrations/0002_spend_permit.sql', import.meta.url), 'utf8',
    );
    expect(sql).toMatch(/ALTER TABLE pending ADD COLUMN paid_allowed INTEGER NOT NULL DEFAULT 0/);
    expect(sql).not.toMatch(/DEFAULT 1/);
  });
});

describe('the runner enforces it where the money is spent', () => {
  it('can only remove the behavioural layer, never add it', async () => {
    // The flag is OR-ed into staticOnly rather than assigned over it, so a
    // runner started with --static-only stays static-only even for a permitted
    // audit, and a missing field costs nothing rather than granting something.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(new URL('../runner/run.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/Number\(job\.paid_allowed \?\? 0\) === 1/);
    expect(src).toMatch(/const jobStaticOnly = staticOnly \|\| !permitted/);
    expect(src).toMatch(/skipBehavioral: jobStaticOnly/);
    // The old unconditional form must be gone, or the permit is decorative.
    expect(src).not.toMatch(/skipBehavioral: staticOnly,/);
  });
});

/**
 * handleGrade itself.
 *
 * The block above tests the permit as a pure function, which is necessary and
 * not sufficient: mutation-checking it found that removing the 401 entirely,
 * and hardcoding every audit to paid, both left the suite green. A correct
 * permit that nothing consults is decorative. This is the same gap that
 * `smoke-x402.mjs` exists to close for the paywall, closed here without needing
 * a live Worker by faking the one binding handleGrade touches.
 */
describe('handleGrade consults the permit', () => {
  /** Records what would have been written, so the SQL and its bindings can be asserted. */
  const fakeDb = () => {
    const batches: Array<Array<{ sql: string; args: unknown[] }>> = [];
    const stmt = (sql: string) => ({
      sql,
      args: [] as unknown[],
      bind(...args: unknown[]) { this.args = args; return this; },
    });
    return {
      batches,
      binding: {
        prepare: (sql: string) => stmt(sql),
        batch: async (s: Array<{ sql: string; args: unknown[] }>) => { batches.push(s); return []; },
      },
    };
  };

  const post = (auth?: string) =>
    new Request('https://scorecard.example/grade', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ url: 'https://mcp.example.com/mcp', needed_for: 'a task' }),
    });

  /** The paid_allowed binding out of the pending INSERT, by position in the SQL. */
  const pendingPermit = (batches: Array<Array<{ sql: string; args: unknown[] }>>) => {
    const row = batches.flat().find((s) => s.sql.includes('INSERT INTO pending'));
    if (!row) throw new Error('no pending INSERT was issued');
    const cols = row.sql.slice(row.sql.indexOf('(') + 1, row.sql.indexOf(')')).split(',').map((c) => c.trim());
    const i = cols.indexOf('paid_allowed');
    expect(i).toBeGreaterThanOrEqual(0);
    return row.args[i];
  };

  it('queues an anonymous request as static-only, and still queues it', async () => {
    const { handleGrade } = await import('../src/routes/grade.js');
    const db = fakeDb();
    const res = await handleGrade(post(), env({ DB: db.binding } as never));
    expect(res.status).toBe(202);
    expect(pendingPermit(db.batches)).toBe(0);
    const body = await res.json() as { audits: Array<{ depth: string; paid_allowed: boolean }> };
    expect(body.audits[0].depth).toBe('static-only');
    expect(body.audits[0].paid_allowed).toBe(false);
  });

  it('queues an authorised request as a full run', async () => {
    const { handleGrade } = await import('../src/routes/grade.js');
    const db = fakeDb();
    const res = await handleGrade(post(`Bearer ${TOKEN}`), env({ DB: db.binding, GRADE_TOKEN: TOKEN } as never));
    expect(res.status).toBe(202);
    expect(pendingPermit(db.batches)).toBe(1);
    const body = await res.json() as { audits: Array<{ depth: string }> };
    expect(body.audits[0].depth).toBe('full');
  });

  it('refuses a wrong token with 401 and queues NOTHING', async () => {
    const { handleGrade } = await import('../src/routes/grade.js');
    const db = fakeDb();
    const res = await handleGrade(post('Bearer wrong'), env({ DB: db.binding, GRADE_TOKEN: TOKEN } as never));
    expect(res.status).toBe(401);
    // The part that matters: a refused request must not leave a row behind.
    expect(db.batches).toHaveLength(0);
  });

  it('refuses a token when the deployment configured none, and queues nothing', async () => {
    const { handleGrade } = await import('../src/routes/grade.js');
    const db = fakeDb();
    const res = await handleGrade(post('Bearer anything'), env({ DB: db.binding } as never));
    expect(res.status).toBe(401);
    expect(db.batches).toHaveLength(0);
  });
});

describe('the MCP endpoint is not the soft way in', () => {
  const mcpReq = (auth?: string) =>
    new Request('https://scorecard.example/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

  it('refuses a wrong token with 401 before parsing a single message', async () => {
    const { handleMcp } = await import('../src/routes/mcp.js');
    const res = await handleMcp(mcpReq('Bearer wrong'), env({ GRADE_TOKEN: TOKEN } as never));
    expect(res.status).toBe(401);
  });

  it('still serves anonymous callers, because that is the whole demo', async () => {
    const { handleMcp } = await import('../src/routes/mcp.js');
    const res = await handleMcp(mcpReq(), env({ GRADE_TOKEN: TOKEN } as never));
    expect(res.status).toBe(200);
  });

  it('writes to the queue through exactly ONE code path', async () => {
    // The drift guard. Two INSERT sites is how the permit came to exist on one
    // of them and not the other; this fails the moment a third appears.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const walk = async (d: string): Promise<string[]> => {
      const out: string[] = [];
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) out.push(...await walk(full));
        else if (e.name.endsWith('.ts')) out.push(await fs.readFile(full, 'utf8'));
      }
      return out;
    };
    // Match the statement, not the phrase. The first version counted the two
    // doc comments that MENTION the insert and failed at 3, which is a test
    // that breaks when you explain the thing it is guarding.
    // Counted by splitting, not by regex: the paren is part of the signal and
    // escaping it wrong silently changed what was being counted.
    const NEEDLE = 'INSERT INTO pending ' + String.fromCharCode(40);
    const src = (await walk(dir)).join(String.fromCharCode(10));
    const hits = src.split(NEEDLE).length - 1;
    expect(hits).toBe(1);
  });
});

describe('the MCP grade tool records the permit it was given', () => {
  /** Same fake as above plus `first()`, which the MCP path uses for its cache lookup. */
  const fakeDb = () => {
    const batches: Array<Array<{ sql: string; args: unknown[] }>> = [];
    const stmt = (sql: string) => ({
      sql,
      args: [] as unknown[],
      bind(...args: unknown[]) { this.args = args; return this; },
      async first() { return null; },   // never graded, so the tool must queue
    });
    return {
      batches,
      binding: {
        prepare: (sql: string) => stmt(sql),
        batch: async (s: Array<{ sql: string; args: unknown[] }>) => { batches.push(s); return []; },
      },
    };
  };

  const call = (auth?: string) =>
    new Request('https://scorecard.example/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'grade', arguments: { url: 'https://mcp.example.com/mcp' } },
      }),
    });

  const permitOf = (batches: Array<Array<{ sql: string; args: unknown[] }>>) => {
    const row = batches.flat().find((s) => s.sql.includes('INSERT INTO pending'));
    if (!row) throw new Error('the grade tool queued nothing');
    const cols = row.sql.slice(row.sql.indexOf('(') + 1, row.sql.indexOf(')')).split(',').map((c) => c.trim());
    return row.args[cols.indexOf('paid_allowed')];
  };

  it('queues an anonymous MCP call as static-only', async () => {
    // The gap a mutation found: the MCP tool had its own INSERT and could have
    // hardcoded the permit without any test noticing.
    const { handleMcp } = await import('../src/routes/mcp.js');
    const db = fakeDb();
    const res = await handleMcp(call(), env({ DB: db.binding, GRADE_TOKEN: TOKEN } as never));
    expect(res.status).toBe(200);
    expect(permitOf(db.batches)).toBe(0);
  });

  it('queues an authorised MCP call as a full run', async () => {
    const { handleMcp } = await import('../src/routes/mcp.js');
    const db = fakeDb();
    const res = await handleMcp(call(`Bearer ${TOKEN}`), env({ DB: db.binding, GRADE_TOKEN: TOKEN } as never));
    expect(res.status).toBe(200);
    expect(permitOf(db.batches)).toBe(1);
  });
});
