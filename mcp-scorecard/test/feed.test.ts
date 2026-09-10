/**
 * The feed is the shared half of a subscription, so its failure mode is not a
 * crash. It is showing a stale grade as current, or dropping a row a poller
 * needed, and a subscriber cannot tell either happened.
 */

import { describe, expect, it } from 'vitest';
import { FEED_MAX, FEED_PAGE, handleFeed } from '../src/routes/feed.js';
import type { Env } from '../src/index.js';

/** Records the SQL and the bindings so the query itself can be asserted. */
function fakeDb(rows: Record<string, unknown>[]) {
  const calls: { sql: string; args: unknown[] }[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const call = { sql, args: [] as unknown[] };
        calls.push(call);
        return {
          bind(...args: unknown[]) { call.args = args; return this; },
          async all<T>() { return { results: rows as T[] }; },
        };
      },
    },
  } as unknown as Env;
  return { env, calls };
}

const row = (over: Record<string, unknown> = {}) => ({
  server_url: 'https://example.com/mcp',
  server_name: 'Example',
  audit_id: 'aud-1',
  grade: 'A',
  score: 91.2,
  static_pct: 91.2,
  behavioral_pct: null,
  guidance_pct: null,
  hard_fail: null,
  model: 'claude-sonnet-5',
  mcpscore_version: '1.11.0',
  completed_at: '2026-09-09T10:00:00.000Z',
  ...over,
});

const call = async (rows: Record<string, unknown>[], qs = '') => {
  const { env, calls } = fakeDb(rows);
  const res = await handleFeed(new URL(`https://api.test/feed${qs}`), env);
  return { res, body: await res.json() as any, calls };
};

describe('the feed query', () => {
  it('asks for one row per server, not one per audit', async () => {
    // A feed of audit EVENTS shows a re-graded server three times and leaves
    // the reader to work out which line is current.
    const { calls } = await call([row()]);
    expect(calls[0].sql).toMatch(/MAX\(completed_at\)/);
    expect(calls[0].sql).toMatch(/GROUP BY server_url/);
  });

  it('orders by when the grade LANDED, not when it was queued', async () => {
    // An audit queued Monday and finished Friday is Friday's news. Ordering by
    // created_at would bury it below everything queued since.
    const { calls } = await call([row()]);
    expect(calls[0].sql).toMatch(/ORDER BY a\.completed_at DESC/);
    expect(calls[0].sql).not.toMatch(/ORDER BY a\.created_at/);
  });

  it('only ever returns complete audits', async () => {
    const { calls } = await call([row()]);
    expect(calls[0].sql).toMatch(/status = 'complete'/);
  });

  it('passes `since` through as a bound parameter', async () => {
    const { calls } = await call([row()], '?since=2026-09-01T00:00:00.000Z');
    expect(calls[0].sql).toMatch(/completed_at > \?/);
    expect(calls[0].args[0]).toBe('2026-09-01T00:00:00.000Z');
  });

  it('caps limit, and survives a limit that is not a number', async () => {
    expect((await call([row()], '?limit=9999')).calls[0].args.at(-1)).toBe(FEED_MAX);
    expect((await call([row()], '?limit=abc')).calls[0].args.at(-1)).toBe(FEED_PAGE);
    expect((await call([row()], '?limit=-5')).calls[0].args.at(-1)).toBe(FEED_PAGE);
    expect((await call([row()], '?limit=10')).calls[0].args.at(-1)).toBe(10);
  });
});

describe('the feed response', () => {
  it('reports an unmeasured layer as null, never as zero', async () => {
    // Invariant 3, at the surface a subscriber actually reads. A zero here
    // would tell someone a server scored nothing on probes that never ran.
    const { body } = await call([row({ behavioral_pct: null, guidance_pct: null })]);
    expect(body.candidates[0].layers.behavioral_pct).toBeNull();
    expect(body.candidates[0].layers.guidance_pct).toBeNull();
    expect(body.candidates[0].layers.static_pct).toBe(91.2);
  });

  it('keeps a real zero as a zero', async () => {
    // The other half of the rule: null must not become the way every low
    // number is reported.
    const { body } = await call([row({ behavioral_pct: 0 })]);
    expect(body.candidates[0].layers.behavioral_pct).toBe(0);
  });

  it('flags rows that are not candidates rather than hiding them', async () => {
    const { body } = await call([
      row({ server_url: 'https://planted-bad-mcp.wanessalabs-042.workers.dev/mcp', audit_id: 'a' }),
      row({ server_url: 'https://scorecard.wanessalabs.com/mcp', audit_id: 'b' }),
      row({ server_url: 'https://mcp.deepwiki.com/mcp', audit_id: 'c' }),
    ]);
    expect(body.count).toBe(3);                       // nothing dropped
    expect(body.candidates[0].is_fixture).toBe(true);
    expect(body.candidates[1].self_graded).toBe(true);
    expect(body.candidates[2].is_fixture).toBe(false);
    expect(body.candidates[2].self_graded).toBe(false);
  });

  it('builds the transcript link from the request origin', async () => {
    // Hardcoding the host would break every self-hosted deployment, and break
    // it in a way that still returns 200.
    const { body } = await call([row({ audit_id: 'xyz' })]);
    expect(body.candidates[0].transcripts).toBe('https://api.test/grade/xyz/transcripts');
  });

  it('returns the newest timestamp as the cursor', async () => {
    const { body } = await call([
      row({ audit_id: 'new', completed_at: '2026-09-09T10:00:00.000Z' }),
      row({ audit_id: 'old', completed_at: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(body.next_since).toBe('2026-09-09T10:00:00.000Z');
  });

  it('returns a NULL cursor on an empty page, not a timestamp', async () => {
    // "Nothing new, keep the cursor you had". Emitting `generated_at` here
    // would move a poller's cursor past rows that land with an earlier
    // completed_at, and it would never see them.
    const { body } = await call([]);
    expect(body.count).toBe(0);
    expect(body.next_since).toBeNull();
  });

  it('says reading it is free, and says it in the body', async () => {
    const { body } = await call([row()]);
    expect(body.price_usdc).toBe(0);
  });

  it('carries the model on every row', async () => {
    // A grade is relative to the model that produced it. A feed that drops the
    // model invites a subscriber to compare two grades that are not comparable.
    const { body } = await call([row()]);
    expect(body.candidates[0].model).toBe('claude-sonnet-5');
  });
});
