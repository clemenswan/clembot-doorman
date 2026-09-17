/**
 * The seam between `suggest()` and the audit report.
 *
 * This is the shape of bug that has no symptom. `auditProject` read
 * `needsResult.matches` and `m.status === 'GAP'`; `suggest()` returns `needs[]`
 * with a `covered` boolean. Every key missed, every filter came back empty, and
 * the report printed "No active capability gaps detected" forever. Nothing
 * threw, nothing logged, and the output was a sentence a healthy build would
 * also print.
 *
 * So the test asserts the CONVERSION against a real `suggest()` result rather
 * than against a hand-written object shaped the way the reader hopes. A fixture
 * built to match the consumer would have passed under the bug.
 */

import { check, describe } from './harness.mjs';
import { suggest } from '../src/needs.mjs';
import { auditProject, renderAuditMarkdown } from '../cli/audit.mjs';

/** Prompts that reach for documentation, which is a need in the taxonomy. */
const PROMPTS = [
  { text: 'can you read the docs for the new wrangler release', session: 's1' },
  { text: 'check the docs before you answer that', session: 's1' },
  { text: 'search the web for the current pricing page', session: 's2' },
];

describe('audit adapter: the suggest() contract this code depends on');
{
  const r = suggest({ prompts: PROMPTS, inventory: {}, candidates: [] });
  check('suggest returns needs[], not matches[]', Array.isArray(r.needs) && r.matches === undefined);
  check('suggest counts under prompts_read, not promptCount',
    r.prompts_read === 3 && r.promptCount === undefined);
  check('a need carries a covered BOOLEAN, not a status string',
    r.needs.length > 0 && typeof r.needs[0].covered === 'boolean' && r.needs[0].status === undefined);
  check('these prompts actually produce unmet needs to convert',
    r.needs.filter((n) => !n.covered).length > 0, `${r.needs.length} needs`);
}

describe('audit adapter: the report carries what suggest found');
{
  // Injected, so this stays offline: no history read, no feed, no network.
  const res = await auditProject(process.cwd(), {
    needsImpl: async () => suggest({ prompts: PROMPTS, inventory: {}, candidates: [] }),
    watchImpl: async () => ({ candidates: [] }),
  });

  check('audit succeeds', res.ok === true, res.why);
  check('prompt count survives the conversion', res.needs.totalPrompts === 3,
    `got ${res.needs.totalPrompts}`);
  check('unmet needs reach the report as gaps', res.needs.gaps.length > 0,
    `got ${res.needs.gaps.length} gaps`);
  check('every gap has a title the renderer can print',
    res.needs.gaps.every((g) => typeof g.title === 'string' && g.title.length > 0));
  check('every gap has a prompt count the renderer can print',
    res.needs.gaps.every((g) => Number.isInteger(g.promptsCount) && g.promptsCount > 0));
  check('the markdown report does NOT claim there are no gaps',
    !renderAuditMarkdown(res).includes('No active capability gaps detected'));
  check('the raw doctor result is exposed for the dashboard to grade',
    res.doctor && res.doctor.ok === true);
}
