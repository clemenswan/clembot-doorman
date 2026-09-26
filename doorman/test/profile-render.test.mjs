/**
 * What the two documents actually say.
 *
 * Snapshot tests here are not "did the bytes change". They pin the specific
 * sentences that make these documents defensible, because those are the ones
 * that would quietly soften: a work package that stops naming its check, an
 * acceptance criterion that turns into a judgement call, a commercial figure
 * that stops being a slot.
 *
 * The clock is frozen. A report whose only moving part is a timestamp cannot
 * be compared against anything.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { check, describe } from './harness.mjs';
import { readSurface } from '../src/profile/surface.mjs';
import { gradeHarness } from '../src/profile/rubric.mjs';
import { buildReport, buildProfile, renderReportMd, repoSlug } from '../src/profile/report.mjs';
import { renderSow, rankGaps, COMMERCIAL_SLOTS } from '../src/profile/sow.mjs';
import { bundledCards } from '../cli/profile.mjs';

// Resolved from this file, not the shell's CWD. See the note in
// profile-rubric.test.mjs: a CWD-relative fixture root reads as an empty
// harness rather than as an error, and turns the negative assertions green.
const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'harnesses');
if (!existsSync(join(FIX, 'strong', '.claude'))) {
  throw new Error(`fixture missing: ${join(FIX, 'strong')} (render tests need the oracle)`);
}

const FROZEN = () => new Date('2026-09-22T00:00:00.000Z');

function reportFor(name) {
  const s = readSurface(join(FIX, name));
  return buildReport(s, gradeHarness(s), { root: join(FIX, name), name, now: FROZEN });
}

const thin = reportFor('thin');
const strong = reportFor('strong');
const cards = bundledCards();

describe('profile render: the slug');

check('a name is used verbatim when given', repoSlug('/x/acme', { name: 'Acme Corp' }) === 'acme-corp');
check('a repo is hashed by default', /^repo-[0-9a-f]{8}$/.test(repoSlug('/x/acme-secret-project')));
check('the hash is stable', repoSlug('/x/acme') === repoSlug('/y/acme'));
check('two repos hash differently', repoSlug('/x/a') !== repoSlug('/x/b'));

describe('profile render: report.md');

const md = renderReportMd(thin);

check('names the slug', md.includes('# Harness profile: thin'));
check('states the band and the score', md.includes('**F** overall') && md.includes('(0%)'));
check('explains that the letter is the worst dimension, not the average',
  /worst dimension, not the average/i.test(md),
  'a capped letter that is not explained reads as a bug');
check('lists every dimension in a table',
  thin.dimensions.every((d) => md.includes(`| ${d.title} |`)));
check('every check appears with its id', thin.checks?.length === undefined
  ? thin.dimensions.flatMap((d) => d.checks).every((c) => md.includes(`\`${c.id}\``))
  : false);
check('every check carries a receipt line',
  (md.match(/^ {2}- receipt: /gm) || []).length === 10,
  'one per check, none omitted');
check('states the surface limit at the end',
  md.includes('harness surface only') && md.includes('No source code'));
check('says an export is the only way anything leaves',
  /--export/.test(md) && /structure only/.test(md));

const strongMd = renderReportMd(strong);
check('a clean report has no FAIL marks', !strongMd.includes('**FAIL**'));
check('and the thin one does', md.includes('**FAIL**'));

describe('profile render: sow.md');

const profile = buildProfile(thin);
const sow = renderSow(thin, cards, { profile });

check('has the five required sections',
  ['## Context', '## Work packages', '## Verification', '## Commercial', '## Appendix']
    .every((h) => sow.includes(h)));

check('every work package names its check id', (() => {
  const wps = sow.match(/#### WP\d\d\./g) || [];
  const checks = sow.match(/- \*\*Check\*\*: `[a-z-]+`/g) || [];
  return wps.length > 0 && wps.length === checks.length;
})(), 'a package with no check id is an opinion');

check('every work package carries an evidence receipt',
  (sow.match(/- \*\*Evidence\*\*: `/g) || []).length === (sow.match(/#### WP\d\d\./g) || []).length);

check('acceptance is re-running the tool, not a judgement', (() => {
  const acc = sow.match(/- \*\*Acceptance\*\*: .+/g) || [];
  return acc.length > 0 && acc.every((a) => a.includes('doorman profile') && a.includes('PASS'));
})());

check('commercial fields are slots and nothing else', (() => {
  return COMMERCIAL_SLOTS.every((s) => sow.includes(`{{${s}}}`));
})(), 'a generated day rate is the one number nobody can check');

check('no work package is proposed for a passing check', (() => {
  const passing = strong.dimensions.flatMap((d) => d.checks).filter((c) => c.state === 'pass');
  const strongSow = renderSow(strong, cards, {});
  return passing.every((c) => !strongSow.includes(`#### WP`) || !strongSow.includes(`\`${c.id}\` (currently PASS`));
})());

check('a fully passing harness proposes nothing', (() => {
  const s = renderSow(strong, cards, {});
  return s.includes('no work to propose that the') && !/#### WP01/.test(s);
})(), 'a generator that always finds work is a generator nobody trusts');

check('the appendix says when a profile was redacted', (() => {
  const dirty = { ...thin, slug: 'x' };
  const p = buildProfile(dirty);
  p.complete = false; p.redacted_count = 3; p.redacted_rules = ['email'];
  const s = renderSow(thin, cards, { profile: p });
  return s.includes('**redacted**') && s.includes('3 value(s)');
})(), 'a censored appendix compared against a full reference reads as a finding');

describe('profile render: gap ranking');

check('cheap gaps sort above expensive ones of the same size', (() => {
  const gaps = rankGaps(thin, cards);
  const S = gaps.findIndex((g) => g.effort === 'S');
  const L = gaps.findIndex((g) => g.effort === 'L');
  return S >= 0 && (L === -1 || S < L);
})(), 'the first milestone wants the cheap wins');

check('passing checks are never ranked as gaps',
  rankGaps(strong, cards).length === 0);

check('a gap against a reference measures the difference, not the absolute', (() => {
  // If the reference also fails a check, closing it is not a gap against them.
  const ref = { dimensions: thin.dimensions.map((d) => ({ key: d.key, checks: d.checks })) };
  const gaps = rankGaps(thin, cards, ref);
  return gaps.every((g) => g.gap === 0 && g.comparedTo === 'reference');
})(), 'comparing to a reference that shares your gap should not invent work');

check('with no reference the comparison is against full marks',
  rankGaps(thin, cards).every((g) => g.comparedTo === 'full-marks'));

describe('profile render: the export contract');

// Q7's ceiling, asserted directly rather than relied on as a side effect of
// redaction. A mutation that put `root` back into the export was caught only
// because an absolute path happens to trip the scanner, which would stop being
// true the moment somebody ran this from a relative path.
{
  const p = buildProfile(thin);
  const flat = JSON.stringify(p);

  check('the export carries no absolute root', p.root === undefined);
  check('and no note prose anywhere', !/"note"/.test(flat),
    'notes are assembled from the repo contents; the cheapest way never to leak prose is never to put prose in the file');
  check('receipts DO survive, repo-relative',
    p.dimensions.flatMap((d) => d.checks).some((c) => typeof c.receipt === 'string'),
    'a gap nobody can locate in their own repo is not actionable');
  check('no receipt is an absolute path',
    p.dimensions.flatMap((d) => d.checks)
      .every((c) => !/^[A-Za-z]:[\\/]|^\/Users\/|^\/home\//.test(String(c.receipt ?? ''))));
  check('counts and scores survive',
    typeof p.pct === 'number' && typeof p.counts === 'object');
  check('it is stamped with what was removed',
    typeof p.redacted_count === 'number' && Array.isArray(p.redacted_rules)
    && typeof p.complete === 'boolean');
  check('the fixture export is clean, so the demo does not open on a censored file',
    p.complete === true && p.redacted_count === 0);
}
