/**
 * The push digest.
 *
 * The consequential assertions are the three under "what it must never say".
 * A notifier fails quietly and cumulatively: the digest keeps looking correct
 * and the operator simply stops reading it, which is indistinguishable from
 * the feature working right up until the session where it mattered.
 */

import { check, describe } from './harness.mjs';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderNotify, consumeDigest, refreshNotify, MAX_LISTED } from '../cli/notify.mjs';

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
