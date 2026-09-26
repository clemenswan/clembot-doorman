/**
 * The push digest.
 *
 * The consequential assertions are the three under "what it must never say".
 * A notifier fails quietly and cumulatively: the digest keeps looking correct
 * and the operator simply stops reading it, which is indistinguishable from
 * the feature working right up until the session where it mattered.
 */

import { check, describe } from './harness.mjs';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderNotify, consumeDigest, refreshNotify, MAX_LISTED } from '../cli/notify.mjs';
import { readSurface } from '../src/profile/surface.mjs';
import { gradeHarness } from '../src/profile/rubric.mjs';
import { buildReport } from '../src/profile/report.mjs';
import { reportDir } from '../src/profile/delta.mjs';

function row(over = {}) {
  return {
    server_url: 'https://mcp.example.com/mcp',
    server_name: 'example',
    grade: 'B',
    score: 78.2,
    model: 'gemini-3.5-flash-lite',
    layers: { static_pct: 80, behavioral_pct: 76, guidance_pct: null },
    verdict: 'unreviewed',
    why: 'not found in any config that could be read',
    is_fixture: false,
    self_graded: false,
    ...over,
  };
}

function feedStub(candidates, next = '2026-09-11T07:00:00Z') {
  return async () => ({ ok: true, json: async () => ({ next_since: next, candidates }) });
}

describe('notify: what it must never say');

// With no cursor the feed returns everything graded so far. Announcing 26 rows
// the first time a plugin loads is a catalogue, not news, and it is the single
// worst first impression this feature could make.
check('says nothing on the first run, whatever the feed holds',
  renderNotify({ candidates: [row(), row(), row()] }, { firstRun: true }) === null);

// No digest file means the hook prints nothing at all. A notifier that reports
// "nothing new" every morning teaches the reader to skip past the one morning
// it has something.
check('says nothing when nothing is new',
  renderNotify({ candidates: [] }) === null &&
  renderNotify({ candidates: [row({ verdict: 'already-installed' })] }) === null &&
  renderNotify({ candidates: [row({ verdict: 'skipped' })] }) === null);

// The feed is deliberately uncurated and carries a server planted to fail.
// Recommending it inside somebody's session would be a real recommendation of
// a hostile server, made by us, unprompted.
check('drops the planted fixture and our own servers',
  renderNotify({ candidates: [
    row({ is_fixture: true, server_url: 'https://planted-bad-mcp.example/mcp' }),
    row({ self_graded: true, server_url: 'https://scorecard.wanessalabs.com/mcp' }),
  ] }) === null);

describe('notify: what a digest carries');

const one = renderNotify({ candidates: [row()] });

// A letter with no model behind it invites a comparison across models that the
// grade cannot support.
check('names the model beside the grade', /gemini-3\.5-flash-lite/.test(one), one);
check('shows the grade', /\*\*B\*\*/.test(one), one);

check('names what was NOT measured rather than implying a full audit',
  /not measured: guidance/.test(one) && !/not measured: behavioral/.test(one), one);

const unscored = renderNotify({ candidates: [row({ score: null, grade: null })] });
check('says "not scored" rather than 0 when there is no score',
  /not scored/.test(unscored) && !/0\/100/.test(unscored), unscored);

const many = renderNotify({
  candidates: Array.from({ length: MAX_LISTED + 4 }, (_, i) =>
    row({ server_url: `https://s${i}.example.com/mcp` })),
});
check('caps the list and counts the rest',
  /and 4 more/.test(many) &&
  many.split('\n').filter((l) => l.startsWith('- **')).length === MAX_LISTED, many);

check('mentions blocked re-grades without listing them',
  /denylist/.test(renderNotify({ candidates: [row({ verdict: 'blocked' })] })));

describe('notify: consume is destructive on purpose');

const dir1 = mkdtempSync(join(tmpdir(), 'doorman-notify-'));
const f1 = join(dir1, 'notify.md');
writeFileSync(f1, 'hello\n', 'utf8');
const first = consumeDigest(f1);
check('prints once and deletes, so news cannot become furniture',
  first === 'hello' && existsSync(f1) === false && consumeDigest(f1) === null);

// This runs at session start. Anything that throws here breaks a session.
check('never throws on a missing or undefined path',
  consumeDigest(join(tmpdir(), 'no-such-' + Date.now())) === null &&
  consumeDigest(undefined) === null);

describe('notify: refresh');

const dir2 = mkdtempSync(join(tmpdir(), 'doorman-refresh-'));
const digest2 = join(dir2, 'notify.md');
const state2 = join(dir2, 'watch.json');
const r1 = await refreshNotify({
  root: dir2, digestFile: digest2, stateFile: state2,
  fetchImpl: feedStub([{
    server_url: 'https://mcp.example.com/mcp', grade: 'A', score: 91,
    model: 'x', layers: {}, is_fixture: false, self_graded: false,
  }]),
});
check('writes no digest on the first run',
  r1.firstRun === true && r1.wrote === false && existsSync(digest2) === false);

// The cursor still moves on a quiet run. Holding it back would re-announce
// every old row the moment something interesting finally landed.
check('saves the cursor even when it announced nothing',
  /2026-09-11T07:00:00Z/.test(readFileSync(state2, 'utf8')));

const dir3 = mkdtempSync(join(tmpdir(), 'doorman-refresh2-'));
const digest3 = join(dir3, 'notify.md');
const state3 = join(dir3, 'watch.json');
writeFileSync(state3, JSON.stringify({ since: '2026-09-10T07:00:00Z', seen: 5 }), 'utf8');
const r2 = await refreshNotify({
  root: dir3, digestFile: digest3, stateFile: state3,
  fetchImpl: feedStub([{
    server_url: 'https://new.example.com/mcp', grade: 'A', score: 91,
    model: 'gemini-3.5-flash-lite',
    layers: { static_pct: 90, behavioral_pct: 92, guidance_pct: 100 },
    is_fixture: false, self_graded: false,
  }]),
});
check('writes a digest on a later run with something new',
  r2.firstRun === false && r2.wrote === true &&
  /new\.example\.com/.test(readFileSync(digest3, 'utf8')));

describe('notify: the harness delta announces once');

// THE BUG THIS PINS. The digest is consumed on read, and the next refresh
// rebuilds it from the same two reports still sitting on disk. Without a
// cursor the delta is therefore regenerated identically at every session
// start, so one fix is re-announced as news every morning until another
// report replaces it. That is worse than a daily "no change", because it
// reads as something having happened.
const dir4 = mkdtempSync(join(tmpdir(), 'doorman-delta-'));
writeFileSync(join(dir4, 'CLAUDE.md'), '# a harness\n', 'utf8');
mkdirSync(join(dir4, '.claude'), { recursive: true });
writeFileSync(join(dir4, '.claude', 'settings.json'),
  JSON.stringify({ permissions: { allow: ['Read'], deny: ['Bash(rm:*)'] } }), 'utf8');

// Learn the slug the same way the code does, then plant a WORSE yesterday so
// today reads as a real improvement.
const surface4 = readSurface(dir4);
const cur4 = buildReport(surface4, gradeHarness(surface4), { root: dir4 });
const prevDir = join(reportDir(dir4, cur4.slug), '2026-01-01');
mkdirSync(prevDir, { recursive: true });
const worse = JSON.parse(JSON.stringify(cur4));
worse.generated_at = '2026-01-01T00:00:00.000Z';
worse.letter = 'F';
for (const d of worse.dimensions ?? []) {
  for (const c of d.checks ?? []) { c.state = 'fail'; c.points = 0; }
}
writeFileSync(join(prevDir, 'report.json'), JSON.stringify(worse), 'utf8');

const digest4 = join(dir4, 'notify.md');
const state4 = join(dir4, 'watch.json');
// Feed returns nothing, so this is the delta half on its own. That is also the
// shape of a real build with no MCP servers, which is the case the delta exists
// for and the one where a never-saved cursor would repeat forever.
const emptyFeed = async () => ({
  ok: true, status: 200,
  json: async () => ({ items: [], next_since: null }),
});

const d1 = await refreshNotify({
  root: dir4, digestFile: digest4, stateFile: state4, fetchImpl: emptyFeed,
});
check('announces the harness delta the first time it sees it',
  d1.delta === true && existsSync(digest4) === true);

const announced = readFileSync(digest4, 'utf8');
consumeDigest(digest4);

const d2 = await refreshNotify({
  root: dir4, digestFile: digest4, stateFile: state4, fetchImpl: emptyFeed,
});
check('does NOT re-announce the same delta on the next session',
  d2.delta === false && existsSync(digest4) === false,
  'an unchanged pair of reports is not news twice');

check('the delta cursor survives a feed that returned nothing',
  /"delta":\s*"/.test(readFileSync(state4, 'utf8')),
  'gating the write on the feed cursor would repeat forever on a build with no servers');

// And it must still speak when something actually moves again.
const prevDir2 = join(reportDir(dir4, cur4.slug), '2026-01-02');
mkdirSync(prevDir2, { recursive: true });
const middling = JSON.parse(JSON.stringify(worse));
middling.generated_at = '2026-01-02T00:00:00.000Z';
const firstCheck = middling.dimensions?.[0]?.checks?.[0];
if (firstCheck) { firstCheck.state = 'pass'; firstCheck.points = firstCheck.max; }
writeFileSync(join(prevDir2, 'report.json'), JSON.stringify(middling), 'utf8');

const d3 = await refreshNotify({
  root: dir4, digestFile: digest4, stateFile: state4, fetchImpl: emptyFeed,
});
check('announces again once the comparison actually changes',
  d3.delta === true && existsSync(digest4) === true,
  'suppression must be per-delta, never a permanent mute');
check('the new announcement is not byte-identical to the muted one',
  readFileSync(digest4, 'utf8') !== announced);
