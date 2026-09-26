/**
 * The three pure functions behind the recommendation panel.
 *
 * Each encodes a decision that was argued once and could be silently undone by
 * a later edit that still passes every other test in this suite:
 *
 *   classifyUnit    fails closed, and path beats kind
 *   attributeSpend  divides evenly, and a missing session makes the total null
 *                   rather than being skipped, so a partial sum can never be
 *                   presented as a complete one
 *   deadWeightIn    reports what history never asked for, and never says remove
 *
 * Every expected value below is written by hand. None is computed by calling
 * the function under test, which is the shape that can never fail.
 */

import { check, describe } from './harness.mjs';
import { classifyUnit, attributeSpend, deadWeightIn } from '../src/needs.mjs';

const costs = (obj) =>
  new Map(Object.entries(obj).map(([k, v]) => [k, { tokens: v, cost_usd: null }]));

/* ── classifyUnit ─────────────────────────────────────────────────────────── */

describe('classifyUnit: the travel boundary');

for (const kind of ['agent', 'command', 'skill', 'routine', 'persona']) {
  check(`scaffolding travels: ${kind}`, classifyUnit(kind, 'anywhere/at/all.md') === 'travels');
}
for (const kind of ['lesson', 'memory', 'evidence']) {
  check(`accumulation stays: ${kind}`, classifyUnit(kind, 'anywhere/at/all.md') === 'stays');
}

// Invariant 27's reasoning. A kind nobody classified must not travel by
// default: a missing capability gets noticed, a leak does not.
check('an unrecognised kind stays, fail closed', classifyUnit('unknown-kind', 'any/path') === 'stays');
check('undefined kind stays', classifyUnit(undefined, 'any/path') === 'stays');
check('null kind and null path stay', classifyUnit(null, null) === 'stays');
check('empty strings stay', classifyUnit('', '') === 'stays');

// A skill filed under clients/ is client material shaped like a skill.
check('path beats kind: memory/', classifyUnit('agent', 'memory/episodes.jsonl') === 'stays');
check('path beats kind: clients/', classifyUnit('skill', 'clients/laguna/agent.md') === 'stays');
check('path beats kind: lessons/', classifyUnit('command', 'vault/lessons/x.md') === 'stays');
check('path beats kind: evidence/', classifyUnit('skill', 'evidence/run-12/grade.json') === 'stays');
check('path beats kind on windows separators',
  classifyUnit('agent', 'C:\\vault\\clients\\laguna\\agent.md') === 'stays');
check('path beats kind on windows memory path',
  classifyUnit('skill', 'C:\\vault\\memory\\decisions.md') === 'stays');

// `memory-events` is a project name, not the memory directory. A loose
// substring match would strand a legitimate agent at home forever.
check('a name merely containing a staying word still travels',
  classifyUnit('agent', 'projects/memory-events/agent.md') === 'travels');
check('clientside is not clients/',
  classifyUnit('skill', 'src/clientside/helper.md') === 'travels');

/* ── attributeSpend ───────────────────────────────────────────────────────── */

describe('attributeSpend: the division is even, and shown');

{
  const out = attributeSpend(
    [{ id: 'a', sessionIds: ['s1'] }, { id: 'b', sessionIds: ['s1'] }],
    costs({ s1: 1000 }),
  );
  check('a session shared by two needs gives each half', out[0].spendTokens === 500 && out[1].spendTokens === 500,
    `got ${out[0].spendTokens} and ${out[1].spendTokens}`);
  check('the note states the denominator', /shared across 2 matched needs/.test(out[0].spendNote),
    out[0].spendNote);
}

{
  const out = attributeSpend([{ id: 'a', sessionIds: ['s1'] }], costs({ s1: 900 }));
  check('a session matched by one need is not divided', out[0].spendTokens === 900, `got ${out[0].spendTokens}`);
}

{
  // Not "skip it and sum the rest". A sum over the readable sessions is a
  // smaller number wearing the appearance of a complete one.
  const out = attributeSpend([{ id: 'a', sessionIds: ['s1', 's-unknown'] }], costs({ s1: 500 }));
  check('one unknown session makes the whole total null', out[0].spendTokens === null, `got ${out[0].spendTokens}`);
  check('and says so', out[0].spendNote === 'tokens not attributed', out[0].spendNote);
}

{
  const out = attributeSpend([{ id: 'a', sessionIds: ['s1'] }], costs({ s1: 0 }));
  check('a measured zero is zero, not missing', out[0].spendTokens === 0, `got ${out[0].spendTokens}`);
  check('a measured zero is not reported as unattributed',
    out[0].spendNote !== 'tokens not attributed', out[0].spendNote);
}

{
  const out = attributeSpend([{ id: 'a', sessionIds: ['s1'] }], null);
  check('no cost map reports unattributed, never zero', out[0].spendTokens === null);
}

{
  // The transcripts carry no cost field at all. Every surface says tokens, and
  // this asserts the wording cannot drift back into implying dollars.
  const out = attributeSpend([{ id: 'a', sessionIds: ['s1'] }], costs({ s1: 10 }));
  check('the note never implies money', !/\$|usd|dollar/i.test(out[0].spendNote), out[0].spendNote);
  check('the note names tokens', /token/i.test(out[0].spendNote), out[0].spendNote);
}

{
  // Three needs share s1; one also has a private session. The shared session is
  // still divided by three for all of them.
  const out = attributeSpend(
    [
      { id: 'a', sessionIds: ['s1'] },
      { id: 'b', sessionIds: ['s1'] },
      { id: 'c', sessionIds: ['s1', 's2'] },
    ],
    costs({ s1: 300, s2: 70 }),
  );
  check('the denominator counts every need a session matched',
    out[0].spendTokens === 100 && out[1].spendTokens === 100,
    `got ${out[0].spendTokens} and ${out[1].spendTokens}`);
  check('a private session adds on top of a shared share', out[2].spendTokens === 170,
    `got ${out[2].spendTokens}`);
}

/* ── deadWeightIn ─────────────────────────────────────────────────────────── */

describe('deadWeightIn: what history never asked for');

const inv = (servers) => ({ mcpServers: servers, allowlisted: [] });

{
  const { unused } = deadWeightIn(
    inv([
      { name: 'weather-station', url: 'https://weather.example/mcp', description: 'forecasts and radar' },
      { name: 'cloudflare-deploy', url: 'https://cf.example/mcp', description: 'wrangler pages deploy' },
    ]),
    [{ id: 'cloud-deploy' }],
  );
  check('a server no active need matches is unused', unused.length === 1 && unused[0].name === 'weather-station',
    JSON.stringify(unused));
  check('every unused unit carries a travel classification',
    unused.length === 1 && ['travels', 'stays'].includes(unused[0].classifiedAs),
    JSON.stringify(unused[0]));
}

{
  const { overlapping, unused } = deadWeightIn(
    inv([
      { name: 'cf-one', url: 'https://a.example/mcp', description: 'cloudflare deploy helper' },
      { name: 'cf-two', url: 'https://b.example/mcp', description: 'wrangler and pages deploy' },
    ]),
    [{ id: 'cloud-deploy' }],
  );
  check('two servers answering one need are not unused', unused.length === 0, JSON.stringify(unused));
  check('and are reported as one overlapping pair',
    overlapping.length === 1 && overlapping[0].names.slice().sort().join(',') === 'cf-one,cf-two',
    JSON.stringify(overlapping));
}

{
  const { overlapping } = deadWeightIn(
    inv([
      { name: 'multi-a', url: 'https://a/mcp', description: 'cloudflare deploy and postgres sql query' },
      { name: 'multi-b', url: 'https://b/mcp', description: 'wrangler deploy and the database' },
    ]),
    [{ id: 'cloud-deploy' }, { id: 'database' }],
  );
  check('a pair overlapping on several needs is one finding, not one per need',
    overlapping.length === 1, JSON.stringify(overlapping));
}

{
  // The server matches `payments`, but this build never asked for payments.
  // Matching the whole taxonomy instead of the active signals would wrongly
  // call it used.
  const { unused } = deadWeightIn(
    inv([{ name: 'stripe-thing', url: 'https://s/mcp', description: 'stripe checkout session' }]),
    [{ id: 'cloud-deploy' }],
  );
  check('a need nobody asked for does not make a server look used', unused.length === 1,
    JSON.stringify(unused));
}

{
  const r = deadWeightIn({}, []);
  check('an empty inventory reports nothing rather than throwing',
    r.unused.length === 0 && r.overlapping.length === 0);
}

/* ── the rendered panel ───────────────────────────────────────────────────── */

describe('renderDashboardHtml: the recommendation panel');

const { renderDashboardHtml } = await import('../cli/dashboard.mjs');

/**
 * A result with the things the live vault could not supply.
 *
 * The end-to-end run against this vault produced zero candidates, because the
 * feed had none, so every candidate-shaped assertion passed by having nothing
 * to check. Synthetic input is the only way to prove the renderer handles a
 * candidate at all, which is the whole point of the travels/stays tag.
 */
const GRADE = { letter: 'B', pct: 80, earned: 8, possible: 10, checks: [] };
const RES = {
  ok: true,
  root: 'C:/fake/build',
  timestamp: '2026-09-21T00:00:00.000Z',
  doctor: { servers: [] },
  posture: { gateStatus: 'wired', isGateWired: true, harnesses: [], installedCount: 0, agentsCount: 0 },
  needs: {
    totalPrompts: 400,
    taxonomySize: 12,
    vaultWide: true,
    historyDirs: ['/a', '/b', '/c'],
    deadWeight: {
      unitsChecked: 2,
      unused: [{ name: 'weather-station', kind: 'mcp-server', classifiedAs: 'stays' }],
      overlapping: [{ needId: 'cloud-deploy', names: ['cf-one', 'cf-two'] }],
    },
    gaps: [{
      id: 'cloud-deploy',
      title: 'Deploying, and reading back what deployed',
      promptsCount: 40,
      sessions: 26,
      terms: ['cloudflare', 'wrangler'],
      // The operator's own sentences. Present in the data, and the renderer
      // must not put them on a page that gets written to disk.
      examples: ['SECRET_EXCERPT_THAT_MUST_NOT_RENDER'],
      spendTokens: 2_979_702_884,
      spendNote: 'tokens shared across 3.2 matched needs in 26 sessions',
      isGap: false,
      coveredBy: null,
      topCandidates: [
        { name: 'cf-deploy-server', url: 'https://cf.example/mcp', grade: 'A', kind: 'mcp-server' },
        { name: 'lesson-deploy-verify', url: null, kind: 'lesson', source: 'lesson corpus' },
      ],
    }],
    covered: [],
  },
  recommendations: [],
  threats: [],
};

const html = renderDashboardHtml(RES, GRADE, null);

check('renders the taxonomy notice', /matches a known list of\s*12 capability terms/.test(html));
check('states it read several history directories', html.includes('<strong>3</strong>'));
check('shows the compacted spend figure', html.includes('3.0B tokens processed'),
  'expected a compacted B figure');
check('never shows a spend figure without its division',
  html.includes('tokens shared across 3.2 matched needs'), 'the note must travel with the number');
check('shows the matched terms', html.includes('<code>cloudflare</code>'));
// The one that matters most: history holds client and personal material.
check('never renders a prompt excerpt', !html.includes('SECRET_EXCERPT_THAT_MUST_NOT_RENDER'));
check('tags an ordinary candidate with its travel class',
  html.includes('>travels<') || html.includes('>stays<'), 'no travels/stays tag rendered');
check('tags a lesson-derived candidate non-travelling', html.includes('>non-travelling<'));
// Invariant 29, on the surface most likely to soften it.
check('uses the worth-measuring verdict', html.includes('worth measuring'));
check('never claims a candidate fits', !/verdict[^<]*\bfits\b/i.test(html));
check('reports dead weight', html.includes('Dead weight') && html.includes('weather-station'));
check('names an overlapping pair', html.includes('cf-one and cf-two'));
check('says dead weight is reported, not a removal instruction',
  html.includes('Reported, not recommended for removal'));

{
  // Nothing installed and nothing unused produce the same empty list, and only
  // one of them is good news.
  const empty = JSON.parse(JSON.stringify(RES));
  empty.needs.deadWeight = { unitsChecked: 0, unused: [], overlapping: [] };
  const h = renderDashboardHtml(empty, GRADE, null);
  check('distinguishes nothing-installed from nothing-unused',
    h.includes('not measured') && !h.includes('Nothing installed that history never asked for'));
}

{
  const none = JSON.parse(JSON.stringify(RES));
  none.needs.gaps[0].spendTokens = null;
  none.needs.gaps[0].spendNote = 'tokens not attributed';
  const h = renderDashboardHtml(none, GRADE, null);
  check('an unattributable need says so rather than showing zero',
    h.includes('cost not attributed') && !h.includes('0 tokens processed'));
}
