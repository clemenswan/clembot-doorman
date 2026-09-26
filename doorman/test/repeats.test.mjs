/**
 * Repeated-procedure detection.
 *
 * Three cases here are not hypotheticals. They are the exact failures the
 * first working version produced against 657 real prompts, kept as tests so
 * the fixes cannot be undone quietly:
 *
 *   1. `[Request interrupted by user for tool use]` clustered as a repeated
 *      "procedure". It is harness text in a real user record.
 *   2. Skill `gsap-core` was reported as covering a cluster because they
 *      shared the words "for", "use" and "user".
 *   3. Command `deploy` was reported as NOT covering a deploy cluster,
 *      because "deploy" is common in this corpus and a rarity cut hid it.
 */

import { check, describe } from './harness.mjs';
import {
  normalise, tokenise, jaccard, documentFrequency, clusterPrompts,
  coveredByUnit, summariseClusters,
  MIN_CLUSTER, COMMON_TOKEN_RATIO, RARE_RATIO, MIN_TOKENS,
} from '../src/repeats.mjs';

const P = (text, session) => ({ text, session });

describe('repeats: stripping arguments, keeping the procedure');

check('a file path is removed', !normalise('fix the test in src/auth.mjs').includes('auth'));
check('a windows path is removed',
  !normalise('read C:\\Users\\me\\notes.md now').includes('users'));
check('a url is removed', !normalise('fetch https://example.com/a/b now').includes('example'));
check('a number is removed', !/\d/.test(normalise('bump to version 2.4.1 today')));
check('a hash is removed', !normalise('revert commit a1b2c3d4e5f now').includes('a1b2c3d4e5f'));
check('fenced code is removed', !normalise('run this\n```\nsecret_value\n```\nplease').includes('secret'));
check('a quoted literal is removed', !normalise('set it to "my long value" ok').includes('long'));

// The whole point: same verb, different argument, one procedure.
check('two runs of one procedure normalise identically',
  normalise('fix the failing test in src/auth.mjs')
  === normalise('fix the failing test in lib/feed.mjs'));

check('different procedures do NOT normalise identically',
  normalise('fix the failing test in a.mjs') !== normalise('deploy the site to production'));

check('short words are dropped', !tokenise('go to the up of it').includes('go'));
check('real words survive', tokenise('deploy the application').includes('deploy'));

describe('repeats: similarity');

check('identical sets score 1', jaccard(new Set(['a', 'b']), new Set(['a', 'b'])) === 1);
check('disjoint sets score 0', jaccard(new Set(['a']), new Set(['b'])) === 0);
check('half overlap scores a third',
  Math.abs(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])) - 1 / 3) < 1e-9);
check('an empty set scores 0, never NaN', jaccard(new Set(), new Set(['a'])) === 0);
check('two empty sets score 0, never NaN', jaccard(new Set(), new Set()) === 0);

check('document frequency counts prompts, not occurrences', (() => {
  const df = documentFrequency([new Set(['a', 'b']), new Set(['a'])]);
  return df.get('a') === 2 && df.get('b') === 1;
})());

describe('repeats: clustering');

const deployish = [
  P('please deploy the changes and commit them', 's1'),
  P('deploy the changes then commit please', 's2'),
  P('commit and deploy these changes please', 's3'),
];

check('a procedure repeated across sessions clusters', (() => {
  const c = clusterPrompts(deployish, { threshold: 0.4 });
  return c.length === 1 && c[0].size === 3;
})());

check('and is labelled cross-session', (() => {
  const c = clusterPrompts(deployish, { threshold: 0.4 });
  return c[0].kind === 'cross-session' && c[0].sessions === 3;
})());

check('the same procedure inside ONE session is labelled within-session', (() => {
  const same = deployish.map((p) => ({ ...p, session: 's1' }));
  const c = clusterPrompts(same, { threshold: 0.4 });
  return c.length === 1 && c[0].kind === 'within-session' && c[0].sessions === 1;
})(), 'a retry loop is not a missing command');

check(`fewer than ${MIN_CLUSTER} members is not a cluster`, (() => {
  const c = clusterPrompts(deployish.slice(0, 2), { threshold: 0.4 });
  return c.length === 0;
})(), 'twice is a coincidence');

check('unrelated prompts do not cluster', (() => {
  const c = clusterPrompts([
    P('deploy the site to production now', 's1'),
    P('write a poem about the ocean', 's2'),
    P('refactor the parser into modules', 's3'),
  ], { threshold: 0.4 });
  return c.length === 0;
})());

// Six prompts so the cut is actually in force (it needs MIN_SIGHTINGS_TO_BE_COMMON
// sightings), a low threshold so the shared boilerplate WOULD join them, and
// otherwise disjoint content so only that boilerplate could. The first version
// of this test used three prompts, where the cut does not apply at all, and it
// passed whether the cut existed or not.
const boilerplate = [
  P('please update the router timing budget', 's1'),
  P('please update the invoice exporter columns', 's2'),
  P('please update the migration ordering rules', 's3'),
  P('please update the avatar wardrobe slots', 's4'),
  P('please update the kalimba tine layout', 's5'),
  P('please update the newsletter digest footer', 's6'),
];

check('a token in most prompts is dropped as undistinctive', (() => {
  const c = clusterPrompts(boilerplate, { threshold: 0.2 });
  return c.length === 0;
})(), `the cut is ${COMMON_TOKEN_RATIO}`);

check('and without it, boilerplate alone WOULD cluster them', (() => {
  // Proves the assertion above is load-bearing rather than passing because
  // the prompts were never similar enough to cluster in the first place.
  const shared = new Set(['please', 'update', 'the']);
  const a = new Set([...tokenise(boilerplate[0].text)]);
  const b = new Set([...tokenise(boilerplate[1].text)]);
  const overlap = [...a].filter((t) => b.has(t));
  return overlap.length === 3 && overlap.every((t) => shared.has(t))
    && jaccard(a, b) >= 0.2;
})());

check('a prompt with too few distinctive tokens is skipped', (() => {
  // Three IDENTICAL prompts of exactly three tokens. They would cluster
  // perfectly at any threshold, so only the floor can stop them. `ok` was
  // the earlier case and it proved nothing: empty token sets never cluster
  // anyway, so the mutant survived.
  const c = clusterPrompts([
    P('run the build', 's1'), P('run the build', 's2'), P('run the build', 's3'),
  ], { threshold: 0.1 });
  return c.length === 0;
})(), `floor is ${MIN_TOKENS} tokens`);

check('one token more and the same prompts DO cluster', (() => {
  const c = clusterPrompts([
    P('run the nightly build', 's1'), P('run the nightly build', 's2'), P('run the nightly build', 's3'),
  ], { threshold: 0.1 });
  return c.length === 1;
})(), 'shows the floor is what rejected the shorter one');

check('the core is the tokens EVERY member shares', (() => {
  const [c] = clusterPrompts(deployish, { threshold: 0.4 });
  return c.coreTokens.includes('deploy') && c.coreTokens.includes('commit');
})());

check('clusters carry examples for evidence', (() => {
  const [c] = clusterPrompts(deployish, { threshold: 0.4 });
  return c.examples.length > 0 && typeof c.examples[0] === 'string';
})());

check('a null session is not counted as a distinct session', (() => {
  const c = clusterPrompts(deployish.map((p) => ({ ...p, session: null })), { threshold: 0.4 });
  return c[0].sessions === 0 && c[0].kind === 'within-session';
})(), 'under-reporting spread is the safe direction');

check('an empty corpus returns no clusters and does not throw',
  clusterPrompts([]).length === 0);

check('plain strings are accepted as well as {text, session}', (() => {
  const c = clusterPrompts([
    'please deploy the changes and commit them',
    'deploy the changes then commit please',
    'commit and deploy these changes please',
  ], { threshold: 0.4 });
  return c.length === 1;
})());

describe('repeats: does a unit already cover it');

const cluster = () => clusterPrompts(deployish, { threshold: 0.4 })[0];

check('a command named `deploy` covers a deploy cluster', (() => {
  const c = coveredByUnit(cluster(), [{ kind: 'command', name: 'deploy', description: '' }]);
  return c && c.name === 'deploy' && c.via === 'name';
})(), 'this was reported as UNCOVERED by the first version');

check('coverage on a common word still works', (() => {
  // "deploy" is deliberately given a high document frequency here, which is
  // what broke the rarity-based matcher: the word is common BECAUSE the
  // activity is frequent.
  const c = { ...cluster(), coreDf: { deploy: 0.9, commit: 0.9 } };
  return coveredByUnit(c, [{ kind: 'command', name: 'deploy', description: '' }])?.via === 'name';
})());

check('three shared COMMON words are not coverage', (() => {
  const c = {
    coreTokens: ['for', 'use', 'user'],
    coreDf: { for: 0.29, use: 0.28, user: 0.27 },
  };
  return coveredByUnit(c, [{ kind: 'skill', name: 'gsap-core', description: 'for use by a user' }]) === null;
})(), 'the first version claimed gsap-core covered a cluster on exactly this');

check('half of a two word name is not enough', (() => {
  const c = { coreTokens: ['test', 'games'], coreDf: { test: 0.2, games: 0.2 } };
  return coveredByUnit(c, [{ kind: 'agent', name: 'test-writer', description: '' }]) === null;
})(), 'a cluster about testing a site is not the test-writer agent');

check('two RARE description words are coverage', (() => {
  const c = { coreTokens: ['kalimba', 'tine'], coreDf: { kalimba: 0.01, tine: 0.01 } };
  const r = coveredByUnit(c, [{ kind: 'skill', name: 'zzz', description: 'kalimba tine layout' }]);
  return r && r.via === 'description';
})(), `rare is below ${RARE_RATIO}`);

check('a cluster with no core is never covered',
  coveredByUnit({ coreTokens: [], coreDf: {} }, [{ name: 'deploy' }]) === null);

check('a unit with no name is skipped rather than throwing',
  coveredByUnit(cluster(), [{ kind: 'command', name: '', description: '' }]) === null);

check('no units means not covered', coveredByUnit(cluster(), []) === null);

describe('repeats: summarise');

check('the two kinds are reported separately and never summed', (() => {
  const s = summariseClusters([
    { kind: 'cross-session', size: 5 },
    { kind: 'within-session', size: 9 },
  ]);
  return s.crossSession === 1 && s.withinSession === 1
    && s.promptsInCross === 5 && s.promptsInWithin === 9;
})(), 'merging them would inflate the figure with the cases that do not support it');

check('the cluster COUNT does not collide with the cluster array key', (() => {
  const s = summariseClusters([{ kind: 'cross-session', size: 3 }]);
  return typeof s.clusterCount === 'number' && s.clusters === undefined;
})(), 'spreading a `clusters` count over a `clusters` array replaced it with a number');

check('the denominator is carried', summariseClusters([], { prompts: 657 }).prompts === 657);
check('a missing denominator is null, not zero', summariseClusters([]).prompts === null);
check('an empty set summarises to zeroes', (() => {
  const s = summariseClusters([]);
  return s.clusterCount === 0 && s.promptsInCross === 0;
})());
