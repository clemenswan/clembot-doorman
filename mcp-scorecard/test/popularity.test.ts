/**
 * The popularity axis, tested at the three places it would lie.
 *
 * 1. A first reading rendered as a trend of zero.
 * 2. Counts from different sources combined into one number.
 * 3. A source that failed to fetch recorded as a zero value.
 *
 * All three produce a plausible number that sorts confidently and is wrong in
 * the flattering direction, which is the direction nobody audits.
 */

import { describe, it, expect } from 'vitest';
import {
  type Observation,
  MIN_TREND_HOURS,
  buildPopularity,
  median,
  percentileWithinSource,
  serverKey,
  trendFor,
} from '../src/popularity.js';

const AT = (iso: string) => iso;

function obs(key: string, source: string, value: number, observed_at: string): Observation {
  const metric = source === 'npm' ? 'weekly_downloads' : source === 'github' ? 'stars' : 'use_count';
  return { server_key: key, source, metric, value, observed_at };
}

describe('serverKey', () => {
  it('keeps the path, because one host can publish several servers', () => {
    // openzeppelin ships four servers under one host. Keying on the host would
    // credit all four with one server's popularity.
    expect(serverKey('https://mcp.openzeppelin.com/contracts/solidity/mcp'))
      .not.toBe(serverKey('https://mcp.openzeppelin.com/contracts/cairo/mcp'));
  });

  it('normalises case and trailing slash so the same server is one key', () => {
    expect(serverKey('https://MCP.DeepWiki.com/mcp/')).toBe(serverKey('https://mcp.deepwiki.com/mcp'));
  });
});

describe('trendFor', () => {
  it('returns null on a single reading, NOT a zero trend', () => {
    // A first observation is not a flat line. Rendering it as 0% growth would
    // sort a brand new entry level with a genuinely stalled one.
    expect(trendFor([obs('a', 'npm', 100, AT('2026-09-11T07:00:00Z'))])).toBeNull();
  });

  it('returns null when the two readings are too close together to mean anything', () => {
    const t = trendFor([
      obs('a', 'npm', 110, AT('2026-09-11T07:00:00Z')),
      obs('a', 'npm', 100, AT('2026-09-11T04:00:00Z')),
    ]);
    expect(t).toBeNull();
  });

  it('computes the delta against a reading far enough back', () => {
    const t = trendFor([
      obs('a', 'npm', 110, AT('2026-09-11T07:00:00Z')),
      obs('a', 'npm', 100, AT('2026-09-10T07:00:00Z')),
    ]);
    expect(t?.delta).toBeCloseTo(0.1, 6);
    expect(t?.value).toBe(110);
    expect(t?.previous).toBe(100);
    expect(t?.window_days).toBe(1);
  });

  it('skips readings inside the window and uses the first one outside it', () => {
    // A manual re-run an hour after the cron must not become the baseline.
    const t = trendFor([
      obs('a', 'npm', 110, AT('2026-09-11T07:00:00Z')),
      obs('a', 'npm', 109, AT('2026-09-11T06:00:00Z')),
      obs('a', 'npm', 100, AT('2026-09-09T07:00:00Z')),
    ]);
    expect(t?.previous).toBe(100);
    expect(t?.window_days).toBe(2);
  });

  it('refuses to compute growth from a zero base', () => {
    // 0 to 5 is not a 500% rise and it is not infinite. It has a value and no
    // delta, and every sort has to cope with that rather than inventing one.
    const t = trendFor([
      obs('a', 'npm', 5, AT('2026-09-11T07:00:00Z')),
      obs('a', 'npm', 0, AT('2026-09-10T07:00:00Z')),
    ]);
    expect(t).not.toBeNull();
    expect(t?.value).toBe(5);
    expect(t?.delta).toBeNull();
  });

  it('reports decline as a negative delta rather than hiding it', () => {
    const t = trendFor([
      obs('a', 'github', 80, AT('2026-09-11T07:00:00Z')),
      obs('a', 'github', 100, AT('2026-09-10T07:00:00Z')),
    ]);
    expect(t?.delta).toBeCloseTo(-0.2, 6);
  });

  it('MIN_TREND_HOURS is what the window check actually uses', () => {
    // Guards against the constant being exported for documentation while the
    // comparison uses a hardcoded number that can drift away from it.
    const justUnder = new Date(Date.UTC(2026, 8, 11, 7, 0, 0) - (MIN_TREND_HOURS - 1) * 3600000);
    const justOver = new Date(Date.UTC(2026, 8, 11, 7, 0, 0) - (MIN_TREND_HOURS + 1) * 3600000);
    const head = obs('a', 'npm', 110, AT('2026-09-11T07:00:00Z'));
    expect(trendFor([head, obs('a', 'npm', 100, justUnder.toISOString())])).toBeNull();
    expect(trendFor([head, obs('a', 'npm', 100, justOver.toISOString())])).not.toBeNull();
  });
});

describe('percentileWithinSource', () => {
  it('contributes nothing when only one server is measured', () => {
    // Top of a field of one is not a ranking. Scoring it 1.0 would let a single
    // obscure package outrank a server ranked against fifty peers.
    const r = percentileWithinSource(new Map([['a', 999999]]));
    expect(r.size).toBe(0);
  });

  it('ranks low to high with the largest at 1', () => {
    const r = percentileWithinSource(new Map([['a', 10], ['b', 20], ['c', 30]]));
    expect(r.get('c')).toBe(1);
    expect(r.get('b')).toBe(0.5);
    expect(r.get('a')).toBe(0);
  });
});

describe('median', () => {
  it('is null on an empty set rather than 0', () => {
    expect(median([])).toBeNull();
  });
  it('averages the middle two on an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('buildPopularity', () => {
  const now = '2026-09-11T07:00:00Z';
  const then = '2026-09-10T07:00:00Z';

  it('never sums across sources, and says how many backed the percentile', () => {
    const keys = ['a', 'b'];
    const observations = [
      obs('a', 'npm', 4200, now), obs('b', 'npm', 100, now),
      obs('a', 'github', 1100, now), obs('b', 'github', 50, now),
      obs('a', 'smithery', 87579, now), obs('b', 'smithery', 12, now),
    ];
    const out = buildPopularity(keys, observations);
    const a = out.get('a');
    // Three sources ranked it, so the percentile rests on three, and the raw
    // counts 4200 + 1100 + 87579 appear nowhere as a total.
    expect(a?.sources_measured).toBe(3);
    expect(a?.percentile).toBe(1);
    expect(a?.sources.npm.value).toBe(4200);
    expect(a?.sources.github.value).toBe(1100);
    expect(JSON.stringify(a)).not.toContain('92879');
  });

  it('omits a source that was never read, rather than scoring it zero', () => {
    // This is the shape of a GitHub 403 from a Cloudflare IP: no reading, no
    // row. Recording it as 0 stars would rank a popular server last.
    const out = buildPopularity(['a', 'b'], [
      obs('a', 'npm', 4200, now), obs('b', 'npm', 100, now),
      obs('b', 'github', 50, now),
    ]);
    const a = out.get('a');
    expect(a?.sources.github).toBeUndefined();
    expect(a?.sources_measured).toBe(1);
    // And b, measured by github alone against a field of one, gets no
    // percentile from it either.
    expect(out.get('b')?.sources_measured).toBe(1);
  });

  it('reports no trend at all until a second reading exists', () => {
    const out = buildPopularity(['a', 'b'], [obs('a', 'npm', 10, now), obs('b', 'npm', 20, now)]);
    expect(out.get('a')?.trend).toBeNull();
    expect(out.get('a')?.sources.npm.delta).toBeNull();
    expect(out.get('a')?.sources.npm.window_days).toBeNull();
    // A percentile is still available: ranking needs one reading, trend needs two.
    expect(out.get('a')?.percentile).toBe(0);
  });

  it('takes the median trend across sources that have one', () => {
    const out = buildPopularity(['a', 'b'], [
      obs('a', 'npm', 110, now), obs('a', 'npm', 100, then),
      obs('a', 'github', 120, now), obs('a', 'github', 100, then),
      obs('b', 'npm', 100, now), obs('b', 'npm', 100, then),
    ]);
    // 0.1 and 0.2 -> 0.15. Not 0.3, and not the larger of the two.
    expect(out.get('a')?.trend).toBeCloseTo(0.15, 6);
    expect(out.get('b')?.trend).toBe(0);
  });

  it('gives a server with no observations at all an empty block, not a zero one', () => {
    const out = buildPopularity(['a'], []);
    const a = out.get('a');
    expect(a?.percentile).toBeNull();
    expect(a?.trend).toBeNull();
    expect(a?.sources_measured).toBe(0);
    expect(Object.keys(a?.sources ?? {})).toHaveLength(0);
  });

  it('keeps server keys containing spaces apart from their source', () => {
    // The series map joins key and source with a space. A key that already
    // contains one must not split in the wrong place and silently merge two
    // servers' readings.
    const weird = 'example.com/a b';
    const out = buildPopularity([weird, 'other.com'], [
      obs(weird, 'npm', 10, now), obs('other.com', 'npm', 20, now),
    ]);
    expect(out.get(weird)?.sources.npm.value).toBe(10);
    expect(out.get('other.com')?.sources.npm.value).toBe(20);
  });
});
