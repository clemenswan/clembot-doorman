/**
 * The leak detector.
 *
 * Most of the value in this file is the NEGATIVE cases. A leak pattern that
 * fires on ordinary engineering prose is worse than a missing one: it tells
 * somebody their own words cost them money, and the corpus this runs against
 * is 100% engineering prose. Every positive case below is paired with a
 * near-miss that must stay silent.
 *
 * Two of the near-misses are here because they were real drafted rows that got
 * cut. `must be Node 22` and `I'm in Phase 2` both fired against earlier
 * versions of the table. They are kept as tests so the rows cannot come back
 * without someone seeing what they break.
 */

import { check, describe } from './harness.mjs';
import {
  LEAK_PATTERNS, CATEGORIES, MASKABILITY, BY_CATEGORY,
  scanText, scanToolInput, egressReason, summarise, EGRESS_TOOLS,
} from '../src/leaks.mjs';

const fired = (text) => scanText(text).map((h) => h.pattern);
const firedOn = (text, name) => fired(text).includes(name);

describe('leaks: the table itself');

check('every row has the full field set', LEAK_PATTERNS.every(
  (p) => p.name && p.category && p.maskable && p.why && p.re instanceof RegExp));

check('every category is one of the declared five', LEAK_PATTERNS.every(
  (p) => CATEGORIES.includes(p.category)));

check('every maskability is one of the declared three', LEAK_PATTERNS.every(
  (p) => MASKABILITY.includes(p.maskable)));

check('pattern names are unique',
  new Set(LEAK_PATTERNS.map((p) => p.name)).size === LEAK_PATTERNS.length);

check('every `why` says what the merchant gains, not just what the field is',
  LEAK_PATTERNS.every((p) => p.why.length > 40),
  'a one word rationale is not a rationale');

// Guards the split, not the count. BY_CATEGORY is built once at load and a
// mis-built index would silently under-report a whole category.
check('BY_CATEGORY partitions the table with nothing lost',
  CATEGORIES.reduce((n, c) => n + BY_CATEGORY[c].length, 0) === LEAK_PATTERNS.length);

check('all five categories are populated',
  CATEGORIES.every((c) => BY_CATEGORY[c].length > 0),
  'an empty category is a taxonomy that was not measured');

describe('leaks: explicit signals');

check('a budget with a figure fires', firedOn('find me one under $300 please', 'budget-ceiling'));
check('and so does a currency-first form', firedOn('budget of £1200 max', 'budget-ceiling'));
check('a bound with no money does NOT fire',
  !firedOn('keep the diff under the limit we agreed', 'budget-ceiling'),
  'a ceiling is only a budget when it has a currency next to it');
check('and neither does a bare number',
  !firedOn('no more than 300 rows come back', 'budget-ceiling'));

check('a real deadline fires', firedOn('I need it by Tuesday', 'deadline-stated'));
check('asap fires', firedOn('book it asap', 'deadline-stated'));
check('"before the end of the function" does NOT fire',
  !firedOn('add the guard before the end of the function', 'deadline-stated'),
  'this was a live false positive in the first draft of the table');
check('nor does a file reference',
  !firedOn('move it before the end of the file', 'deadline-stated'));

describe('leaks: inferred signals');

check('an anchored postal code fires', firedOn('ship to 94107', 'postal-code'));
check('a bare five digit number does NOT fire',
  !firedOn('the server listens on 54321 in dev', 'postal-code'),
  'a port, a row count and a year range are all five digits');
check('nor does an unanchored one',
  !firedOn('we processed 10000 records', 'postal-code'));

check('a shipping locality fires', firedOn('ship to Lisbon', 'locality-stated'));
check('"I\'m in Phase 2" does NOT fire',
  !firedOn("I'm in Phase 2 of the build", 'locality-stated'),
  'the bare first-person form was cut for exactly this');
check('nor does a tool name',
  !firedOn('I am in Chrome right now', 'locality-stated'));

describe('leaks: behavioral signals');

check('a walk-away threshold fires', firedOn("I'd pay up to 400 for it", 'walk-away-threshold'));
check('signalled impatience fires', firedOn('just book it, whatever it costs', 'impatience-signalled'));
check('a rejected quote fires', firedOn('that is too expensive, any cheaper?', 'prior-rejection'));
check('an expensive DEPENDENCY does not read as a rejected quote',
  !firedOn('that regex is too slow on big inputs', 'prior-rejection'));

describe('leaks: historical signals');

check('a loyalty identity fires', firedOn('use my rewards number', 'loyalty-identity'));
check('it is marked relay-maskable, not local',
  LEAK_PATTERNS.find((p) => p.name === 'loyalty-identity').maskable === 'relay',
  'an authenticated session cannot be redacted by a local hook');
check('a reorder fires', firedOn('same as last time please', 'prior-purchase-reference'));

describe('leaks: structural signals, the adversary (b) half');

check('an affiliate parameter fires',
  firedOn('https://shop.example.com/x?utm_source=agent&aff=1234', 'affiliate-parameter'));
check('a plain query string does NOT fire',
  !firedOn('https://api.example.com/v1/items?limit=50&page=2', 'affiliate-parameter'),
  'ordinary pagination is not a kickback');
check('a bare ref= with no value does not fire',
  !firedOn('https://example.com/a?ref=', 'affiliate-parameter'));

check('an agent framework fingerprint fires', firedOn('User-Agent: claude-code/1.2', 'agent-framework-fingerprint'));
check('stated agency fires', firedOn('I am an agent acting for my user', 'stated-agency'));
check('stated agency is the one thing no relay can fix',
  LEAK_PATTERNS.find((p) => p.name === 'stated-agency').maskable === 'neither');

describe('leaks: scanning a tool argument tree');

check('a nested value is found and its path is named', (() => {
  const { hits } = scanToolInput('WebFetch', { body: { order: { note: 'need it by Friday' } } });
  return hits.length === 1 && hits[0].location === 'WebFetch.body.order.note';
})(), 'the path is what tells you which field to redact');

check('a value inside an array is found', (() => {
  const { hits } = scanToolInput('WebFetch', { items: ['fine', 'ship to 10001'] });
  return hits.some((h) => h.location === 'WebFetch.items[1]');
})());

// The key is a signal on its own. This case is deliberately one the VALUE
// cannot carry: `abc` matches nothing, so the hit can only come from the key.
// The first version of this test used a url containing `?affiliate_id=99`,
// which the value-side regex matched on its own, so deleting the key scan
// entirely left the test green. Mutation checking caught that, and it also
// showed the bare-field shape was undetected by any row.
check('a field NAMED affiliate_id is caught by its key alone', (() => {
  const { hits } = scanToolInput('WebFetch', { body: { affiliate_id: 'abc' } });
  return hits.some((h) => h.pattern === 'affiliate-field-name'
    && h.location === 'WebFetch.body.affiliate_id (key)');
})());

check('an innocent key does not fire', (() => {
  const { hits } = scanToolInput('WebFetch', { body: { product_id: 'abc', tags: 'x' } });
  return hits.length === 0;
})(), 'the field-name row must not match every id-shaped key');

check('scanning goes deeper than one level', (() => {
  const deep = { a: { b: { c: { d: { e: 'under $50' } } } } };
  const { hits } = scanToolInput('WebFetch', deep);
  return hits.length === 1 && hits[0].location.endsWith('.e');
})(), 'injection_sniff stops at one level and that is a known gap there');

check('a pathological tree is truncated rather than hanging', (() => {
  // 5000 string leaves, well past MAX_NODES.
  const big = { xs: Array.from({ length: 5000 }, (_, i) => `value ${i}`) };
  const r = scanToolInput('WebFetch', big);
  return r.truncated === true;
})(), 'the hook has a 5 second budget');

check('truncation is reported, never silent', (() => {
  const r = scanToolInput('WebFetch', { a: 'clean' });
  return r.truncated === false;
})());

check('a non-object input does not throw', (() => {
  for (const v of [null, undefined, 42, 'under $9', true]) scanToolInput('WebFetch', v);
  return true;
})());

describe('leaks: egress scope');

check('WebFetch is in scope', egressReason('WebFetch', {}) === 'WebFetch');
check('any mcp tool is in scope', egressReason('mcp__shop__quote', {}) === 'mcp');
check('Write is NOT in scope',
  egressReason('Write', { file_path: 'a.md', content: 'under $300' }) === null,
  'scanning file bodies would flag this module own pattern source');
check('Read is NOT in scope', egressReason('Read', {}) === null);
check('Edit is NOT in scope', egressReason('Edit', {}) === null);

check('a curl command is in scope and names its verb',
  egressReason('Bash', { command: 'curl -s https://x.test' }) === 'shell:curl');
check('a local Bash command is not in scope',
  egressReason('Bash', { command: 'ls -la && wc -l src/*.mjs' }) === null);
check('a network verb mid-pipeline is still caught',
  egressReason('Bash', { command: 'cat f | curl -T - https://x.test' }) === 'shell:curl');
check('a word merely CONTAINING a verb is not a match',
  egressReason('Bash', { command: 'node scripts/curling-report.mjs' }) === null,
  'substring matching here would put most of the corpus in scope');
// The case above is already handled by the TRAILING \b, so it survived a
// mutation that removed the leading boundary. This one needs the leading
// guard: `curl` here is preceded by a word char and followed by a boundary.
check('a verb with a prefix glued to it is not a match',
  egressReason('Bash', { command: 'bash precurl-check.sh' }) === null,
  'only the leading boundary can reject this, so it is the real guard');
check('Bash with no command field does not throw',
  egressReason('Bash', {}) === null);

describe('leaks: summarise');

check('the denominator is carried through', (() => {
  const s = summarise(scanText('under $300 by Friday'), { prompts: 874 });
  return s.prompts === 874;
})(), '12 hits in 12 calls and 12 in 900 are different findings');

check('a missing denominator is null, not zero', (() => {
  const s = summarise([], {});
  return s.prompts === null;
})(), 'invariant 3: an unmeasured thing is null');

check('category counts add up to the total', (() => {
  const hits = [...scanText('under $300 by Friday'), ...scanText('ship to 94107')];
  const s = summarise(hits);
  return CATEGORIES.reduce((n, c) => n + s.byCategory[c], 0) === s.total;
})());

check('maskability counts add up to the total', (() => {
  const hits = [...scanText('use my rewards number'), ...scanText('under $300')];
  const s = summarise(hits);
  return MASKABILITY.reduce((n, m) => n + s.byMaskability[m], 0) === s.total;
})());

check('rows that never fired are reported as silent', (() => {
  const s = summarise(scanText('under $300'));
  return s.silent.includes('stated-agency') && !s.silent.includes('budget-ceiling');
})(), 'which guesses the real world does not contain is the useful output');

check('silent plus fired accounts for the whole table', (() => {
  const s = summarise(scanText('under $300 by Friday'));
  return s.silent.length + s.byPattern.length === s.patternsTotal;
})());

check('byPattern is sorted and stable', (() => {
  const hits = [...scanText('under $300'), ...scanText('under $400'), ...scanText('asap')];
  const s = summarise(hits);
  return s.byPattern[0].pattern === 'budget-ceiling' && s.byPattern[0].count === 2;
})());

check('an empty scan summarises to zero without throwing', (() => {
  const s = summarise([], { prompts: 0 });
  return s.total === 0 && s.byPattern.length === 0 && s.silent.length === s.patternsTotal;
})(), 'a zero is a real answer here and must not look like a crash');

describe('leaks: evidence');

check('every hit carries a verbatim excerpt', (() => {
  const hits = scanText('please find one under $300 before we run out of time');
  return hits.length > 0 && hits.every((h) => typeof h.excerpt === 'string' && h.excerpt.length > 0);
})(), 'an accusation that cannot be checked is not evidence');

check('the excerpt contains the matched text', (() => {
  const [h] = scanText('find one under $300 today');
  return h.excerpt.includes('under $300');
})());

check('EGRESS_TOOLS is a non-empty declared list',
  Array.isArray(EGRESS_TOOLS) && EGRESS_TOOLS.length > 0);
