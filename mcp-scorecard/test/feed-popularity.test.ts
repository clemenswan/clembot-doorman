/**
 * Popularity as it actually reaches a subscriber, through handleFeed.
 *
 * SEPARATE FROM feed.test.ts ON PURPOSE. That file's stub returns the same
 * rows for EVERY prepare(), which is fine for asserting the audit query and
 * useless here: the popularity query would be handed audit rows, produce
 * nothing, and the test would pass while measuring nothing. The stub below
 * routes on the SQL, so a popularity query gets popularity rows.
 */

import { describe, it, expect } from 'vitest';
import { handleFeed } from '../src/routes/feed.js';
import { handleLinkSubject } from '../src/routes/popularity.js';
import type { Env } from '../src/index.js';

type Row = Record<string, unknown>;

/** Routes by table so each query sees rows of its own shape. */
function fakeDb(audits: Row[], popularity: Row[], opts: { popThrows?: boolean } = {}) {
  return {
    DB: {
      prepare(sql: string) {
        const isPop = sql.includes('FROM popularity');
        return {
          bind() { return this; },
          async all<T>() {
            if (isPop) {
              if (opts.popThrows) throw new Error('no such table: popularity');
              return { results: popularity as T[] };
            }
            return { results: audits as T[] };
          },
        };
      },
    },
  } as unknown as Env;
}

const audit = (url: string, over: Row = {}): Row => ({
  server_url: url,
  server_name: 'Example',
  audit_id: 'aud-' + url,
  grade: 'A',
  score: 91.2,
  static_pct: 91.2,
  behavioral_pct: null,
  guidance_pct: null,
  hard_fail: null,
  model: 'claude-sonnet-5',
  mcpscore_version: '1.11.0',
  completed_at: '2026-09-11T07:00:00Z',
  ...over,
});

const obs = (key: string, source: string, value: number, at: string): Row => ({
  server_key: key,
  source,
  metric: source === 'npm' ? 'weekly_downloads' : 'stars',
  value,
  observed_at: at,
});

const NOW = '2026-09-11T07:00:00Z';
const YESTERDAY = '2026-09-10T07:00:00Z';

async function feed(env: Env, query = '') {
  const res = await handleFeed(new URL('https://scorecard.example/feed' + query), env);
  return await res.json() as {
    candidates: Array<{ server_url: string; score: number | null; popularity: null | {
      percentile: number | null; trend: number | null; sources_measured: number;
      sources: Record<string, { value: number; delta: number | null }>;
    } }>;
    popularity_note: string;
  };
}

describe('feed popularity', () => {
  it('attaches per-source readings keyed by the normalised server url', async () => {
    const env = fakeDb(
      [audit('https://a.example.com/mcp'), audit('https://b.example.com/mcp')],
      [
        obs('a.example.com/mcp', 'npm', 4200, NOW),
        obs('b.example.com/mcp', 'npm', 100, NOW),
      ],
    );
    const body = await feed(env);
    const a = body.candidates.find((c) => c.server_url.includes('a.example'));
    expect(a?.popularity?.sources.npm.value).toBe(4200);
    expect(a?.popularity?.percentile).toBe(1);
    expect(a?.popularity?.sources_measured).toBe(1);
  });

  it('leaves the SCORE untouched, whatever popularity says', async () => {
    // The one rule the whole axis exists to respect. A server ranked top on
    // every source must score exactly what its probes scored.
    const env = fakeDb(
      [audit('https://a.example.com/mcp', { score: 62.5, grade: 'C' })],
      [obs('a.example.com/mcp', 'npm', 999999, NOW), obs('z.other/mcp', 'npm', 1, NOW)],
    );
    const body = await feed(env);
    expect(body.candidates[0].score).toBe(62.5);
  });

  it('reports a server with no observations as null, not as unpopular', async () => {
    const env = fakeDb([audit('https://a.example.com/mcp')], []);
    const body = await feed(env);
    const p = body.candidates[0].popularity;
    expect(p?.percentile).toBeNull();
    expect(p?.trend).toBeNull();
    expect(p?.sources_measured).toBe(0);
  });

  it('serves grades normally when the popularity table does not exist', async () => {
    // A deployment that has not run the migration must still serve the feed.
    // Failing the whole read over a second axis nobody asked for would be a
    // worse outcome than having no popularity at all.
    const env = fakeDb([audit('https://a.example.com/mcp')], [], { popThrows: true });
    const body = await feed(env);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].popularity).toBeNull();
  });

  it('sort=trending puts movement first and rows with NO trend last', async () => {
    // A DECLINING server is what makes this test able to fail. With only a
    // flat one, "null sorts last" and "null counts as zero" produce the same
    // order and the assertion proves nothing. Against -20%, treating an
    // unmeasured server as 0% growth floats it above a server that is
    // genuinely losing users, which is the wrong answer in the flattering
    // direction: it promotes the thing nobody has measured.
    const env = fakeDb(
      [
        audit('https://falling.example.com/mcp'),
        audit('https://untracked.example.com/mcp'),
        audit('https://rising.example.com/mcp'),
      ],
      [
        obs('rising.example.com/mcp', 'npm', 200, NOW),
        obs('rising.example.com/mcp', 'npm', 100, YESTERDAY),
        obs('falling.example.com/mcp', 'npm', 80, NOW),
        obs('falling.example.com/mcp', 'npm', 100, YESTERDAY),
      ],
    );
    const body = await feed(env, '?sort=trending');
    const order = body.candidates.map((c) => c.server_url);
    expect(order[0]).toContain('rising');
    expect(order[1]).toContain('falling');
    expect(order[2]).toContain('untracked');
  });

  it('sorts the same way whichever order the rows arrive in', async () => {
    // The comparator has two null branches and a three-element sort only
    // exercises one of them, depending on which side the engine passes the
    // untracked row. Reversing the input fires the other. Without this, a
    // mutation that breaks the mirror branch passes the test above.
    const pop = [
      obs('rising.example.com/mcp', 'npm', 200, NOW),
      obs('rising.example.com/mcp', 'npm', 100, YESTERDAY),
      obs('falling.example.com/mcp', 'npm', 80, NOW),
      obs('falling.example.com/mcp', 'npm', 100, YESTERDAY),
    ];
    const urls = [
      'https://falling.example.com/mcp',
      'https://untracked.example.com/mcp',
      'https://rising.example.com/mcp',
    ];
    for (const rows of [urls, [...urls].reverse()]) {
      const body = await feed(fakeDb(rows.map((u) => audit(u)), pop), '?sort=trending');
      const order = body.candidates.map((c) => c.server_url);
      expect(order[0]).toContain('rising');
      expect(order[1]).toContain('falling');
      expect(order[2]).toContain('untracked');
    }
  });

  it('leaves the default order alone when sort is absent or unknown', async () => {
    const audits = [audit('https://first.example.com/mcp'), audit('https://second.example.com/mcp')];
    const pop = [
      obs('second.example.com/mcp', 'npm', 200, NOW),
      obs('second.example.com/mcp', 'npm', 100, YESTERDAY),
    ];
    for (const q of ['', '?sort=popular', '?sort=']) {
      const body = await feed(fakeDb(audits, pop), q);
      expect(body.candidates[0].server_url).toContain('first');
    }
  });

  it('states on the wire that popularity is not part of the score', async () => {
    const body = await feed(fakeDb([audit('https://a.example.com/mcp')], []));
    expect(body.popularity_note).toMatch(/never part of the score/i);
    expect(body.popularity_note).toMatch(/never summed/i);
  });
});

/**
 * The mapping write. Its whole job is refusing a subject that would publish
 * some other project's numbers under this server's name.
 */
describe('POST /popularity/subject', () => {
  function linkEnv(token = 'secret-token') {
    const writes: unknown[][] = [];
    const env = {
      RUNNER_TOKEN: token,
      DB: {
        prepare() {
          return {
            bind(...args: unknown[]) { writes.push(args); return this; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      },
    } as unknown as Env;
    return { env, writes };
  }

  const post = (body: unknown, token?: string) => new Request('https://x/popularity/subject', {
    method: 'POST',
    headers: token ? { authorization: 'Bearer ' + token } : {},
    body: JSON.stringify(body),
  });

  it('refuses without the runner token, and writes nothing', async () => {
    const { env, writes } = linkEnv();
    const res = await handleLinkSubject(post({ server_url: 'https://a/mcp', source: 'npm', subject: 'x' }), env);
    expect(res.status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it('refuses when no RUNNER_TOKEN is configured at all', async () => {
    // An unconfigured deployment accepts nothing rather than everything.
    const { env } = linkEnv(undefined as unknown as string);
    const res = await handleLinkSubject(post({ server_url: 'https://a/mcp', source: 'npm', subject: 'x' }, 'anything'), env);
    expect(res.status).toBe(401);
  });

  it('refuses a github subject that is not owner/repo', async () => {
    // A bare name resolves to a 404 forever while the mapping row sits there
    // looking correct, so the server is silently never measured.
    const { env, writes } = linkEnv();
    const res = await handleLinkSubject(post({ server_url: 'https://a/mcp', source: 'github', subject: 'servers' }, 'secret-token'), env);
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('refuses an unknown source rather than storing a row nothing sweeps', async () => {
    const { env, writes } = linkEnv();
    const res = await handleLinkSubject(post({ server_url: 'https://a/mcp', source: 'twitter', subject: 'x' }, 'secret-token'), env);
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('stores the NORMALISED key so the sweep and the feed agree', async () => {
    const { env, writes } = linkEnv();
    const res = await handleLinkSubject(
      post({ server_url: 'https://MCP.DeepWiki.com/mcp/', source: 'github', subject: 'owner/repo' }, 'secret-token'),
      env,
    );
    expect(res.status).toBe(200);
    expect(writes[0][0]).toBe('mcp.deepwiki.com/mcp');
  });

  it('fetches nothing, and says so', async () => {
    const { env } = linkEnv();
    const res = await handleLinkSubject(post({ server_url: 'https://a/mcp', source: 'npm', subject: 'pkg' }, 'secret-token'), env);
    const body = await res.json() as { note: string };
    expect(body.note).toMatch(/Nothing was fetched/i);
  });
});
