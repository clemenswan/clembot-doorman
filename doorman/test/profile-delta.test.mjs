/**
 * The harness delta, and the silence that makes it readable.
 *
 * The failure mode here is not a wrong number. It is a channel that speaks
 * every morning, because a session-start note that says "no change" daily
 * teaches the operator to skip past the one morning it matters. Half these
 * tests assert that nothing is said.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import { reportDir, previousReport, diffReports, renderDelta } from '../src/profile/delta.mjs';

/** A minimal report, shaped like buildReport's output. */
const rep = (letter, pct, checks, at = '2026-09-21T00:00:00.000Z') => ({
  slug: 'x', letter, pct, generated_at: at,
  dimensions: [{ id: 1, key: 'permission-hygiene', title: 'Permission hygiene', checks }],
});
const chk = (id, state, receipt = '.claude/settings.json:2') =>
  ({ id, title: id, state, points: state === 'pass' ? 4 : 0, max: 4, receipt, note: null });

describe('profile delta: silence');

check('no prior report is silent', diffReports(null, rep('A', 100, [chk('a', 'pass')])) === null,
  'the first run would otherwise announce every check as news');
check('no current report is silent', diffReports(rep('A', 100, []), null) === null);
check('an identical report is silent', (() => {
  const r = rep('B', 80, [chk('a', 'pass'), chk('b', 'fail')]);
  return diffReports(r, r) === null;
})(), 'a daily "no change" is how a notification becomes furniture');
check('renderDelta of null is null', renderDelta(null) === null);

describe('profile delta: what moved');

check('a fixed check is named and labelled', (() => {
  const d = diffReports(rep('F', 0, [chk('a', 'fail')]), rep('A', 100, [chk('a', 'pass')]));
  return d.moved.length === 1 && d.moved[0].kind === 'fixed' && d.moved[0].id === 'a';
})());

check('a regression is labelled BROKE, loudly', (() => {
  const d = diffReports(rep('A', 100, [chk('a', 'pass')]), rep('F', 0, [chk('a', 'fail')]));
  const text = renderDelta(d);
  return d.moved[0].kind === 'broke' && text.includes('**BROKE**') && text.includes('DOWN');
})(), 'a band going down must not read the same as one going up');

check('a band going up says up', (() => {
  const text = renderDelta(diffReports(rep('F', 0, [chk('a', 'fail')]), rep('A', 100, [chk('a', 'pass')])));
  return text.includes(' up from ') && !text.includes('DOWN');
})());

check('measured to n/a is "changed", never "fixed"', (() => {
  const d = diffReports(rep('F', 0, [chk('a', 'fail')]), rep('F', 0, [chk('a', 'n/a')]));
  return d.moved[0].kind === 'changed';
})(), 'a check that stopped being measurable did not get fixed');

check('n/a to pass is also "changed", not a win', (() => {
  const d = diffReports(rep('F', 0, [chk('a', 'n/a')]), rep('A', 100, [chk('a', 'pass')]));
  return d.moved[0].kind === 'changed';
})());

check('a new check id is reported as new', (() => {
  const d = diffReports(rep('A', 100, [chk('a', 'pass')]), rep('A', 100, [chk('a', 'pass'), chk('b', 'fail')]));
  return d.moved.length === 1 && d.moved[0].kind === 'added' && d.moved[0].id === 'b';
})(), 'the rubric grew; that is not the operator regressing');

check('a removed check id is reported as gone', (() => {
  const d = diffReports(rep('A', 100, [chk('a', 'pass'), chk('b', 'pass')]), rep('A', 100, [chk('a', 'pass')]));
  return d.moved.some((m) => m.kind === 'removed' && m.id === 'b');
})());

check('a band change with no check change is still news', (() => {
  // Possible when a dimension's denominator moves. Reporting nothing here
  // would leave the letter changing with no explanation anywhere.
  const d = diffReports(rep('B', 80, [chk('a', 'pass')]), rep('A', 90, [chk('a', 'pass')]));
  return d !== null && d.moved.length === 0 && renderDelta(d).includes('up from');
})());

describe('profile delta: every line is actionable');

check('each moved line carries its receipt', (() => {
  const text = renderDelta(diffReports(
    rep('F', 0, [chk('a', 'fail')]),
    rep('A', 100, [chk('a', 'pass', '.claude/settings.json:7')]),
  ));
  return text.includes('`.claude/settings.json:7`');
})(), 'a note saying it got worse without saying where costs attention and returns nothing');

check('an absent receipt is not printed as the word absent', (() => {
  const text = renderDelta(diffReports(rep('A', 100, [chk('a', 'pass')]), rep('F', 0, [chk('a', 'fail', 'absent')])));
  return !text.includes('`absent`');
})());

check('it says what to run next', (() => {
  const text = renderDelta(diffReports(rep('F', 0, [chk('a', 'fail')]), rep('A', 100, [chk('a', 'pass')])));
  return text.includes('doorman profile') && text.includes('--sow');
})());

describe('profile delta: finding the prior report');

function seed(days) {
  const root = mkdtempSync(join(tmpdir(), 'delta-prev-'));
  const dir = reportDir(root, 'x');
  for (const [day, body] of Object.entries(days)) {
    mkdirSync(join(dir, day), { recursive: true });
    writeFileSync(join(dir, day, 'report.json'), body);
  }
  return { root, dir };
}

check('it reads the most recent day STRICTLY before today', (() => {
  const { root, dir } = seed({
    '2026-09-18': JSON.stringify(rep('F', 10, [], '2026-09-18T00:00:00.000Z')),
    '2026-09-19': JSON.stringify(rep('C', 60, [], '2026-09-19T00:00:00.000Z')),
    '2026-09-20': JSON.stringify(rep('A', 99, [], '2026-09-20T00:00:00.000Z')),
  });
  try { return previousReport(dir, '2026-09-20').letter === 'C'; }
  finally { rmSync(root, { recursive: true, force: true }); }
})(), "today's own report must not be compared against itself");

check('a corrupt report is skipped for an older one, not fatal', (() => {
  const { root, dir } = seed({
    '2026-09-18': JSON.stringify(rep('F', 10, [], '2026-09-18T00:00:00.000Z')),
    '2026-09-19': '{ not json',
  });
  try { return previousReport(dir, '2026-09-20').letter === 'F'; }
  finally { rmSync(root, { recursive: true, force: true }); }
})(), 'one bad file must not silence the channel permanently');

check('no directory at all returns null rather than throwing',
  previousReport(join(tmpdir(), 'definitely-not-here-' + Date.now()), '2026-09-20') === null);

check('non-date directories are ignored', (() => {
  const { root, dir } = seed({ latest: JSON.stringify(rep('A', 99, [])) });
  try { return previousReport(dir, '2026-09-20') === null; }
  finally { rmSync(root, { recursive: true, force: true }); }
})());
