import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_MIN_INTERVAL_MS, RUNNER_STALE_AFTER_MS,
  recordRunnerSeen, runnerPresence,
} from '../src/runner-presence.js';

/**
 * The 2026-09-19 launch audit: the last `claimed` event was six days old and
 * `POST /grade` was still answering 202 with a poll url. Nothing lied about a
 * grade; the service lied about the expectation of one.
 */

/** A D1 stub that stores, so a heartbeat written in one call is read in the next. */
function memoryDb(opts: { failOn?: 'select' | 'write' } = {}) {
  const rows = new Map<string, string>();       // runner -> last_seen
  let writes = 0;
  const binding = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      return {
        sql,
        bind(...args: unknown[]) { bound = args; return this; },
        async first() {
          if (opts.failOn === 'select') throw new Error('D1 unavailable');
          if (sql.includes('ORDER BY last_seen DESC')) {
            const newest = [...rows.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1))[0];
            return newest ? { runner: newest[0], last_seen: newest[1] } : null;
          }
          const [runner] = bound as [string];
          const seen = rows.get(runner);
          return seen ? { last_seen: seen } : null;
        },
        async run() {
          if (opts.failOn === 'write') throw new Error('D1 unavailable');
          writes++;
          const [runner, lastSeen] = bound as [string, string];
          rows.set(runner, lastSeen);
          return {};
        },
      };
    },
  };
  return { rows, get writes() { return writes; }, binding: binding as unknown as D1Database };
}

const env = (db: ReturnType<typeof memoryDb>) => ({ DB: db.binding });

describe('runnerPresence', () => {
  it('a never-polled deployment is offline, and says nothing is lost', async () => {
    const p = await runnerPresence(env(memoryDb()));
    expect(p.online).toBe(false);
    expect(p.last_seen).toBeNull();
    expect(p.note).toMatch(/has ever polled|until one connects/);
  });

  it('a recent poll is online, and adds no note to a caller', async () => {
    const db = memoryDb();
    await recordRunnerSeen(env(db), 'runner-1', 1_000_000);
    const p = await runnerPresence(env(db), 1_000_000 + RUNNER_STALE_AFTER_MS - 1);
    expect(p.online).toBe(true);
    expect(p.note).toBeNull();
    expect(p.runner).toBe('runner-1');
  });

  it('goes offline once the poll is older than the window, and dates it', async () => {
    const db = memoryDb();
    await recordRunnerSeen(env(db), 'runner-1', 1_000_000);
    const p = await runnerPresence(env(db), 1_000_000 + RUNNER_STALE_AFTER_MS + 1);
    expect(p.online).toBe(false);
    expect(p.note).toContain(new Date(1_000_000).toISOString());
  });

  it('an unreadable table is UNKNOWN, never a false alarm of offline', async () => {
    const p = await runnerPresence(env(memoryDb({ failOn: 'select' })));
    expect(p.online).toBeNull();
    expect(p.note).toBeNull();
  });
});

describe('recordRunnerSeen', () => {
  it('records the POLL, so a runner on an empty queue still counts as present', async () => {
    // The whole reason this is not derived from `claimed` rows: claiming
    // nothing is what a healthy runner does on a quiet day.
    const db = memoryDb();
    await recordRunnerSeen(env(db), 'quiet-runner', 5_000_000);
    expect((await runnerPresence(env(db), 5_000_000)).online).toBe(true);
  });

  it('throttles, so polling every few seconds is not a write every few seconds', async () => {
    const db = memoryDb();
    await recordRunnerSeen(env(db), 'r', 10_000_000);
    await recordRunnerSeen(env(db), 'r', 10_000_000 + 5_000);
    await recordRunnerSeen(env(db), 'r', 10_000_000 + 10_000);
    expect(db.writes).toBe(1);
  });

  it('writes again once the throttle window passes', async () => {
    const db = memoryDb();
    await recordRunnerSeen(env(db), 'r', 20_000_000);
    await recordRunnerSeen(env(db), 'r', 20_000_000 + HEARTBEAT_MIN_INTERVAL_MS + 1);
    expect(db.writes).toBe(2);
  });

  it('a failing heartbeat never breaks the poll it rode in on', async () => {
    await expect(
      recordRunnerSeen(env(memoryDb({ failOn: 'write' })), 'r', 1),
    ).resolves.toBeUndefined();
  });
});

/**
 * The surfaces, driven. `runnerPresence` being correct while `POST /grade`
 * never mentioned it is precisely the failure this closes, and the rate-limit
 * work in this same branch already had two mutants survive by exactly that
 * shape: correct logic, route that ignored it.
 */
describe('the queue says whether anything is listening', () => {
  const dbFor = () => {
    const rows = new Map<string, string>();
    const binding = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        return {
          sql,
          bind(...args: unknown[]) { bound = args; return this; },
          async first() {
            if (sql.includes('ORDER BY last_seen DESC')) {
              const newest = [...rows.entries()][0];
              return newest ? { runner: newest[0], last_seen: newest[1] } : null;
            }
            return null;   // no cached grade, no rate-limit row: fresh window
          },
          async run() { return {}; },
          get __write() { return () => {}; },
        };
      },
      async batch(stmts: Array<{ __write?: () => void }>) {
        for (const s of stmts) s.__write?.();
        return [];
      },
    };
    return { rows, binding: binding as unknown as D1Database };
  };

  const envOf = (db: ReturnType<typeof dbFor>) =>
    ({ DB: db.binding, PROBE_MODEL: 'm', PROBE_TEMPERATURE: '0', PROBE_RUNS: '3' } as never);

  it('POST /grade carries the runner state and folds it into the note', async () => {
    const { handleGrade } = await import('../src/routes/grade.js');
    const db = dbFor();
    const res = await handleGrade(
      new Request('https://scorecard.example/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.9' },
        body: JSON.stringify({ url: 'https://mcp.example.com/mcp' }),
      }),
      envOf(db),
    );
    expect(res.status).toBe(202);
    const body = await res.json() as { runner: { online: boolean | null }; note: string };
    expect(body.runner.online).toBe(false);
    expect(body.note).toMatch(/until one connects/);
  });

  it('the MCP tool says it too, because that is the surface an agent reads', async () => {
    const { handleMcp } = await import('../src/routes/mcp.js');
    const db = dbFor();
    const res = await handleMcp(
      new Request('https://scorecard.example/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.10' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'grade', arguments: { url: 'https://mcp.example.com/mcp' } },
        }),
      }),
      envOf(db),
    );
    const body = await res.json() as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(body.result.content[0].text) as
      { runner_online: boolean | null; runner_note?: string };
    expect(payload.runner_online).toBe(false);
    expect(payload.runner_note).toMatch(/until one connects/);
  });
});

/**
 * The poll handler, driven.
 *
 * Deleting `recordRunnerSeen` from `handlePending` passed every test above:
 * the function worked, and nothing called it. Third time in this branch that a
 * correct unit has been wired to nothing, so this test claims ZERO work on
 * purpose. An empty queue is the exact case that made claims unusable as a
 * presence signal, so a heartbeat written here is the whole point.
 */
describe('GET /api/pending records presence even when it claims nothing', () => {
  it('an authenticated poll of an EMPTY queue makes the runner present', async () => {
    const { handlePending } = await import('../src/routes/runner.js');
    const rows = new Map<string, string>();
    const binding = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        return {
          sql,
          bind(...args: unknown[]) { bound = args; return this; },
          async all() { return { results: [] }; },          // nothing to claim
          async first() {
            if (sql.includes('ORDER BY last_seen DESC')) {
              const n = [...rows.entries()][0];
              return n ? { runner: n[0], last_seen: n[1] } : null;
            }
            const [runner] = bound as [string];
            const seen = rows.get(runner);
            return seen ? { last_seen: seen } : null;
          },
          async run() {
            const [runner, lastSeen] = bound as [string, string];
            if (sql.includes('runner_seen')) rows.set(runner, lastSeen);
            return {};
          },
        };
      },
    } as unknown as D1Database;

    const env = { DB: binding, RUNNER_TOKEN: 'a-long-enough-runner-token-value' } as never;
    const res = await handlePending(
      new Request('https://scorecard.example/api/pending?runner=laptop-1', {
        headers: { authorization: 'Bearer a-long-enough-runner-token-value' },
      }),
      new URL('https://scorecard.example/api/pending?runner=laptop-1'),
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: 0 });
    expect((await runnerPresence({ DB: binding })).online).toBe(true);
  });

  it('an UNAUTHENTICATED poll cannot fake presence', async () => {
    const { handlePending } = await import('../src/routes/runner.js');
    const rows = new Map<string, string>();
    const binding = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        return {
          sql,
          bind(...args: unknown[]) { bound = args; return this; },
          async all() { return { results: [] }; },
          async first() {
            if (sql.includes('ORDER BY last_seen DESC')) {
              const n = [...rows.entries()][0];
              return n ? { runner: n[0], last_seen: n[1] } : null;
            }
            return null;
          },
          async run() {
            const [runner, lastSeen] = bound as [string, string];
            if (sql.includes('runner_seen')) rows.set(runner, lastSeen);
            return {};
          },
        };
      },
    } as unknown as D1Database;

    const env = { DB: binding, RUNNER_TOKEN: 'a-long-enough-runner-token-value' } as never;
    const res = await handlePending(
      new Request('https://scorecard.example/api/pending?runner=liar'),
      new URL('https://scorecard.example/api/pending?runner=liar'),
      env,
    );

    expect(res.status).toBe(401);
    expect(rows.size).toBe(0);
    expect((await runnerPresence({ DB: binding })).online).toBe(false);
  });
});
