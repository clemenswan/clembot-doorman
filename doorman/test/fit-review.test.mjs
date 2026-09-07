/**
 * Fit review.
 *
 * The three verdict cases are the headline, but the validation tests are the
 * ones that matter. A fit review that names a subagent you do not have reads
 * as placement advice and is fiction, and nothing downstream would catch it:
 * the note writer would render it, and you would flip a status based on it.
 */

import { check, describe, rejects } from './harness.mjs';
import { candidates, inventory, json, renderInventory, stubLlm } from './fixtures.mjs';
import {
  FIT_VERDICTS,
  FitReviewError,
  extractJson,
  fitReview,
  validateVerdict,
} from '../src/fit-review.mjs';

const run = (responses, candidate = candidates.redundant) =>
  fitReview(candidate, inventory, { llm: stubLlm(responses), renderInventory });

describe('fit review: the three verdicts');
{
  const r = await run([
    json({
      verdict: 'redundant',
      owner: null,
      rationale: 'The researcher subagent already fetches and reads web pages.',
      overlaps: [
        { kind: 'agent', name: 'researcher', why: 'already holds WebFetch' },
        { kind: 'skill', name: 'defuddle', why: 'extracts readable text from a url' },
      ],
    }),
  ]);
  check('a clearly redundant candidate returns redundant', r.verdict === 'redundant', r.verdict);
  check('redundant names what already covers it', r.overlaps.length === 2, String(r.overlaps.length));
  check('redundant carries no owner', r.owner === null, String(r.owner));
  check('the model used is recorded on the verdict', r.model === 'claude-sonnet-5', r.model);
  check('a first-attempt answer reports one attempt', r.attempts === 1, String(r.attempts));
}
{
  const r = await run(
    [json({
      verdict: 'fits',
      owner: 'scheduler',
      rationale: 'Nothing here touches a calendar. The scheduler already plans work across a week.',
      overlaps: [],
    })],
    candidates.fits,
  );
  check('a genuinely new capability returns fits', r.verdict === 'fits', r.verdict);
  check('fits names an owner that exists', r.owner === 'scheduler', String(r.owner));
}
{
  const r = await run(
    [json({
      verdict: 'out-of-scope',
      owner: null,
      rationale: 'This system does not handle money and has no reason to place trades.',
      overlaps: [],
    })],
    candidates.outOfScope,
  );
  check('a capability the system has no business having is out-of-scope',
    r.verdict === 'out-of-scope', r.verdict);
  check('out-of-scope carries no owner', r.owner === null, String(r.owner));
}

describe('fit review: the model is not trusted about your own system');
{
  // The important one. `planner` is not in the inventory; `scheduler` is.
  const good = json({
    verdict: 'fits', owner: 'scheduler',
    rationale: 'New capability, scheduler is the right home.', overlaps: [],
  });
  const llm = stubLlm([
    json({ verdict: 'fits', owner: 'planner', rationale: 'Planner should own it.', overlaps: [] }),
    good,
  ]);
  const r = await fitReview(candidates.fits, inventory, { llm, renderInventory });
  check('an invented subagent is rejected and retried', r.owner === 'scheduler', String(r.owner));
  check('the retry says the name was not in the inventory',
    /"planner".*not a subagent in the inventory/s.test(llm.calls[1].user),
    llm.calls[1].user.slice(0, 160));
}
{
  const llm = stubLlm([
    json({
      verdict: 'redundant', owner: null, rationale: 'Covered already.',
      overlaps: [{ kind: 'skill', name: 'web-reader', why: 'reads pages' }],
    }),
    json({
      verdict: 'redundant', owner: null, rationale: 'Covered already.',
      overlaps: [{ kind: 'skill', name: 'defuddle', why: 'reads pages' }],
    }),
  ]);
  const r = await fitReview(candidates.redundant, inventory, { llm, renderInventory });
  check('an invented overlap is rejected and retried',
    r.overlaps[0].name === 'defuddle', r.overlaps[0].name);
}
{
  const e = await rejects(() => run([
    json({ verdict: 'fits', owner: null, rationale: 'It fits somewhere.', overlaps: [] }),
    json({ verdict: 'fits', owner: null, rationale: 'It fits somewhere.', overlaps: [] }),
  ], candidates.fits));
  check('"fits" with a null owner is not a placement', e instanceof FitReviewError, String(e));
}
{
  const e = await rejects(() => run([
    json({ verdict: 'out-of-scope', owner: 'scheduler', rationale: 'No.', overlaps: [] }),
    json({ verdict: 'out-of-scope', owner: 'scheduler', rationale: 'No.', overlaps: [] }),
  ]));
  check('an owner on a non-fits verdict is rejected', e instanceof FitReviewError, String(e));
}
{
  const e = await rejects(() => run([
    json({ verdict: 'redundant', owner: null, rationale: 'Already covered.', overlaps: [] }),
    json({ verdict: 'redundant', owner: null, rationale: 'Already covered.', overlaps: [] }),
  ]));
  check('"redundant" with no overlaps is rejected', e instanceof FitReviewError, String(e));
}

describe('fit review: malformed responses');
{
  const good = json({ verdict: 'out-of-scope', owner: null, rationale: 'No.', overlaps: [] });
  const r = await run(['not json at all', good], candidates.outOfScope);
  check('malformed JSON retries once and succeeds', r.verdict === 'out-of-scope', r.verdict);
  check('the retry is reported in the attempt count', r.attempts === 2, String(r.attempts));
}
{
  const e = await rejects(() => run(['nope', 'still nope']));
  check('malformed twice fails loudly', e instanceof FitReviewError, String(e));
  check('the failure carries every attempt for debugging',
    /attempt 1.*attempt 2/s.test(e.message), e.message.slice(0, 120));
  check('the failure keeps the last raw response', e.lastResponse === 'still nope', e.lastResponse);
}
{
  const e = await rejects(() => run(['{"verdict":"maybe","owner":null,"rationale":"x","overlaps":[]}',
                                     '{"verdict":"maybe","owner":null,"rationale":"x","overlaps":[]}']));
  check('a verdict outside the closed set is rejected', e instanceof FitReviewError, String(e));
}

describe('fit review: response extraction');
{
  check('a bare object parses', extractJson('{"a":1}').ok === true);
  check('a ```json fence parses', extractJson('```json\n{"a":1}\n```').ok === true);
  check('a bare fence parses', extractJson('```\n{"a":1}\n```').ok === true);
  check('prose around the object does NOT parse',
    extractJson('Here you go: {"a":1}').ok === false);
  check('a bare array does not count as an object',
    extractJson('[1,2]').ok === false);
  check('an empty response is malformed', extractJson('   ').ok === false);
}

describe('fit review: validation is inventory-relative');
{
  const problems = validateVerdict(
    { verdict: 'fits', owner: 'researcher', rationale: 'ok', overlaps: [] },
    inventory,
  );
  check('a real subagent name validates', problems.length === 0, problems.join(' '));

  const allowlistedOverlap = validateVerdict(
    {
      verdict: 'redundant', owner: null, rationale: 'ok',
      overlaps: [{ kind: 'mcp-server', name: 'scorecard', why: 'already graded and allowlisted' }],
    },
    inventory,
  );
  check('an already-allowlisted server is a citable overlap',
    allowlistedOverlap.length === 0, allowlistedOverlap.join(' '));

  const emptyInv = { agents: [], skills: [], mcpServers: [], allowlisted: [] };
  const noAgents = validateVerdict(
    { verdict: 'fits', owner: 'researcher', rationale: 'ok', overlaps: [] },
    emptyInv,
  );
  check('the same name fails against an inventory that lacks it',
    noAgents.length === 1, noAgents.join(' '));
}
{
  check('the four verdicts are the closed set',
    FIT_VERDICTS.join(',') === 'redundant,fits,needs-new-subagent,out-of-scope',
    FIT_VERDICTS.join(','));
}
