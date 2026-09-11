/**
 * Precision of the needs taxonomy, measured against this vault's real prompts.
 *
 * WHY THIS FILE EXISTS. `doorman needs` counts a build's own sentences and
 * turns the count into a suggestion. That is only honest if the count is of
 * things the operator actually asked for, and the first version of it was not.
 *
 * Two separate failures, both found by looking at the output rather than by
 * reading the code:
 *
 *   THE READER. 1548 of 1656 `user` records in this vault's transcripts are
 *   tool results, not prompts. Claude Code files them on the same channel.
 *   Counting them produced a report whose evidence quotes were fragments of
 *   skill files, and it inflated every need roughly threefold: cloud-deploy
 *   went from a true 24 to a reported 61.
 *
 *   THE TERMS. Of 94 matches on the cleaned corpus, a hand check found 10
 *   false. Four classes, all represented verbatim below: the product name that
 *   is also an English word (`slack`, `notion`), the filesystem path that is
 *   not an ask (`.obsidian/`, `logs/queue/`), the capability named in order to
 *   REJECT it, and the plain over-broad term (`the worker` meaning a subagent).
 *
 * Every string here is real, from this vault's own history on 2026-09-10. They
 * are quoted rather than summarised because a corpus nobody can check is not a
 * measurement.
 */

import { check, describe } from './harness.mjs';
import { NEEDS, termHit, isRealPrompt, excerpt } from '../src/needs.mjs';

const need = (id) => NEEDS.find((n) => n.id === id);

/** Real prompts that must NOT be counted as a need. Why each is innocent. */
const INNOCENT = [
  ['comms', 'Row 1 has ~64px slack at 390px, so 360px phones are fine, 320px is marginal.',
   'slack the noun, meaning spare room in a layout'],
  ['comms', 'the 180px of footer slack that broke the old observer is now inert',
   'same word again, and it appeared twice in one corpus'],
  ['knowledge-base', 'advanceMatch has no notion of a round winner at all, it only maintains points',
   'notion the ordinary English word'],
  ['knowledge-base', 'Never touch node_modules/, .git/, .obsidian/, Archives/, memory*',
   'a path in an exclusion list, not a request for a knowledge base'],
  ['observability', 'The run respects the logs/queue/.runner.lock convention',
   'a directory, and the term was `the logs`'],
  ['database', 'I would like to avoid supabase or any database backend',
   'named in order to rule it out. Counting this inverts the signal'],
  ['database', 'local vector store, no Postgres/Neo4j/OpenSearch; that is enterprise weight',
   'the same rejection, phrased as a stack constraint'],
  ['cloud-deploy', 'The skill you build keeps the worker/critic fan-out and discards the rest',
   'a subagent in a fan-out. Nothing to do with a Cloudflare Worker'],
  ['cloud-deploy', 'Verify the worker’s claim that design/tokens.css genuinely reaches the page',
   'the same word, same wrong sense, a second time'],
  ['comms', 'getting helpful corrections from technical teams on Slack). 18. Campbell’s Law',
   'prose ABOUT Slack inside pasted content. This one still trips, and is left in'],
];

/** Real prompts that must be counted. The capability is genuinely wanted. */
const GUILTY = [
  ['cloud-deploy', 'thanks. commit and deploy so I can see in clemvault under main'],
  ['cloud-deploy', 'can you use wrangler to create the first deploy and then I’ll attach the domain'],
  ['code-host', 'yes, push branch and open a PR'],
  ['code-host', 'can we update the exe into the release of github as well?'],
  ['payments', 'within Stripe when adding a product, where do I put the WORKER_SECRET?'],
  ['payments', 'where is test mode for stripe?'],
  ['browser-automation',
   'i just installed playwright-cli. Can you make sure you use it instead of the screenshots'],
  ['browser-automation',
   'confirm visually at 320 / 375 / 768 widths using Playwright against pnpm dev'],
  ['knowledge-base', 'commit the wiki and docs too'],
  ['design-assets', 'Read CLAUDE.md and design/brand.md first; both are normative.'],
];

describe('needs precision: the reader separates prompts from everything else');

// The single most consequential filter in the command. A `user` record carrying
// a tool result is 93% of the channel in this vault.
check('a tool result is not a prompt',
  !isRealPrompt({ type: 'user', toolUseResult: { stdout: 'deploy to cloudflare ok' } }));
check('a compaction summary is not a prompt',
  !isRealPrompt({ type: 'user', isCompactSummary: true }));
check('a meta record is not a prompt',
  !isRealPrompt({ type: 'user', isMeta: true }));
check('a sidechain (subagent) turn is not this build’s operator asking',
  !isRealPrompt({ type: 'user', isSidechain: true }));
check('an ordinary typed message IS a prompt',
  isRealPrompt({ type: 'user', message: { content: 'deploy it' } }));
check('an assistant turn is never a prompt',
  !isRealPrompt({ type: 'assistant', message: { content: 'ok' } }));

describe('needs precision: false positives, hand-checked 2026-09-10');

// Count the trips and assert the COUNT, the same ratchet discover-precision
// uses. Asserting each string individually makes the suite permanently red over
// the one that is genuinely hard, and a permanently red suite stops being read.
let falsePositives = 0;
const tripped = [];
for (const [id, text, why] of INNOCENT) {
  const hit = termHit(text, need(id).terms);
  if (hit) {
    falsePositives += 1;
    tripped.push(`${id} on "${hit}" - ${why}\n        ${excerpt(text, hit, 80)}`);
  }
}
console.log(`  ${INNOCENT.length - tripped.length} of ${INNOCENT.length} real innocent prompts are clean, ${falsePositives} false positives:`);
for (const t of tripped) console.log(`      still tripping: ${t}`);

/**
 * Measured, not aspirational. One of the ten still trips: prose about Slack
 * inside pasted content, where the word is capitalised and the sentence is
 * genuinely about Slack, just not a request for it. Distinguishing "I want
 * Slack" from "here is an article mentioning Slack" needs a model, and this
 * command is deliberately keyless.
 *
 * If a change pushes this below 1, LOWER THE BASELINE in the same commit. A
 * ratchet that only ever holds steady stops being evidence of anything.
 */
const KNOWN_FALSE_POSITIVES = 1;

check(`false positives have not increased past the ${KNOWN_FALSE_POSITIVES} recorded on 2026-09-10`,
  falsePositives <= KNOWN_FALSE_POSITIVES,
  `${falsePositives} of ${INNOCENT.length} innocent prompts flagged`);

check('the baseline still matches what actually happens',
  falsePositives === KNOWN_FALSE_POSITIVES,
  falsePositives < KNOWN_FALSE_POSITIVES
    ? `precision IMPROVED to ${falsePositives}. Lower KNOWN_FALSE_POSITIVES to ${falsePositives} in this commit.`
    : '');

describe('needs precision: real asks are still detected');

for (const [id, text] of GUILTY) {
  const hit = termHit(text, need(id).terms);
  check(`${id} detected: ${text.slice(0, 54)}`, Boolean(hit),
    hit ? '' : 'a real ask went uncounted, which is how tightening goes too far');
}

describe('needs precision: a dotfile is not a hostname');

// The guard that rejects `.obsidian/` rejected `docs.mcp.cloudflare.com` too,
// and that threw away the highest-graded candidate in the first real run. A
// leading dot and an interior dot are different things.
check('a hostname still matches, dots and all',
  termHit('https://docs.mcp.cloudflare.com/mcp', need('cloud-deploy').terms) === 'cloudflare');
check('a dotfile path still does not',
  termHit('never touch .obsidian/ or Archives/', need('knowledge-base').terms) === null);
check('a candidate url that IS the capability survives',
  termHit('https://github.run.tools', need('code-host').terms) === 'github');

describe('needs precision: the taxonomy is checkable by hand');

check('every need declares why it matters, so a suggestion can be argued with',
  NEEDS.every((n) => n.why && n.why.length > 20));
check('every need carries at least three terms',
  NEEDS.every((n) => n.terms.length >= 3));
check('the taxonomy is small enough that a human can check it',
  NEEDS.length <= 20, `${NEEDS.length} needs`);
check('no two needs share an id',
  new Set(NEEDS.map((n) => n.id)).size === NEEDS.length);
