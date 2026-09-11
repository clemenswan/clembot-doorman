/**
 * The source fetchers, pinned to the shapes the live APIs actually return.
 *
 * These are characterization tests over three third-party payloads, written
 * after calling each one for real on 2026-09-11. The Smithery case exists
 * because the first implementation read the detail endpoint, which does not
 * carry `useCount` at all: it would have returned null for every Smithery
 * server forever, and the feed would have called that "not measured" rather
 * than "broken", which is correct behaviour on bad input and therefore silent.
 */

import { describe, it, expect } from 'vitest';
import { fetchGithub, fetchNpm, fetchSmithery, readOne } from '../src/popularity-sweep.js';
import type { Env } from '../src/index.js';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

/** The real list-row shape, trimmed to the fields this code reads. */
const SMITHERY_LIST = {
  servers: [
    { qualifiedName: 'subway-other', useCount: 999999 },
    { qualifiedName: 'subwayinfo', useCount: 22961, homepage: 'https://subwayinfo.nyc', verified: true },
  ],
};

/** The real DETAIL shape. Note what is absent: useCount and homepage. */
const SMITHERY_DETAIL = {
  qualifiedName: 'subwayinfo',
  displayName: 'SubwayInfo NYC',
  description: 'Real-time NYC subway information.',
  remote: true,
  deploymentUrl: 'https://subwayinfo.run.tools',
  connections: [], security: {}, tools: [], resources: [], prompts: [],
};

describe('fetchSmithery', () => {
  it('reads useCount from the LIST row', async () => {
    const f = (async () => ok(SMITHERY_LIST)) as unknown as typeof fetch;
    expect(await fetchSmithery('subwayinfo', f)).toBe(22961);
  });

  it('returns null, never a number, if handed the detail shape', async () => {
    // Pins the actual failure. If someone repoints this at /servers/{id}, the
    // payload has no useCount and this test is the only thing that notices.
    const f = (async () => ok(SMITHERY_DETAIL)) as unknown as typeof fetch;
    expect(await fetchSmithery('subwayinfo', f)).toBeNull();
  });

  it('matches the exact qualifiedName rather than taking the first result', async () => {
    // A search for "exa" returns many servers. Taking servers[0] would publish
    // a different product's installs under this server's name.
    const f = (async () => ok(SMITHERY_LIST)) as unknown as typeof fetch;
    expect(await fetchSmithery('subwayinfo', f)).not.toBe(999999);
  });

  it('returns null when the name is not in the results at all', async () => {
    const f = (async () => ok({ servers: [{ qualifiedName: 'something-else', useCount: 5 }] })) as unknown as typeof fetch;
    expect(await fetchSmithery('subwayinfo', f)).toBeNull();
  });

  it('queries the list endpoint, not the detail endpoint', async () => {
    let seen = '';
    const f = (async (url: string) => { seen = String(url); return ok(SMITHERY_LIST); }) as unknown as typeof fetch;
    await fetchSmithery('subwayinfo', f);
    expect(seen).toContain('/servers?q=');
    expect(seen).not.toMatch(/\/servers\/subwayinfo/);
  });
});

describe('fetchNpm', () => {
  it('reads the weekly download count', async () => {
    const f = (async () => ok({ downloads: 4200, package: 'x' })) as unknown as typeof fetch;
    expect(await fetchNpm('x', f)).toBe(4200);
  });

  it('returns null on a 404 rather than zero downloads', async () => {
    // A package that does not exist has NOT been measured at zero downloads.
    const f = (async () => bad(404)) as unknown as typeof fetch;
    expect(await fetchNpm('nope', f)).toBeNull();
  });
});

describe('fetchGithub', () => {
  it('reads stargazers_count', async () => {
    const f = (async () => ok({ stargazers_count: 8382 })) as unknown as typeof fetch;
    expect(await fetchGithub('idosal/git-mcp', undefined, f)).toBe(8382);
  });

  it('returns null on a 403, which is the EXPECTED path from a Worker', async () => {
    // GitHub rate-limits unauthenticated calls to 60/hour per IP and Workers
    // egress from shared addresses. Recording 0 stars here would rank a
    // popular server last on the strength of a rate limit.
    const f = (async () => bad(403)) as unknown as typeof fetch;
    expect(await fetchGithub('a/b', undefined, f)).toBeNull();
  });

  it('sends the token only when there is one', async () => {
    let withToken: unknown;
    let without: unknown;
    const cap = (sink: (h: unknown) => void) => (async (_u: string, init: { headers: Record<string, string> }) => {
      sink(init.headers.authorization); return ok({ stargazers_count: 1 });
    }) as unknown as typeof fetch;
    await fetchGithub('a/b', 'tok', cap((h) => { withToken = h; }));
    await fetchGithub('a/b', undefined, cap((h) => { without = h; }));
    expect(withToken).toBe('Bearer tok');
    expect(without).toBeUndefined();
  });
});

describe('readOne', () => {
  const env = {} as Env;

  it('returns null for a source it does not know, rather than throwing', async () => {
    expect(await readOne({ server_key: 'a', source: 'twitter', subject: 'x' }, env)).toBeNull();
  });

  it('swallows a thrown fetch into null: no reading, no row', async () => {
    const f = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await readOne({ server_key: 'a', source: 'npm', subject: 'x' }, env, f)).toBeNull();
  });
});
