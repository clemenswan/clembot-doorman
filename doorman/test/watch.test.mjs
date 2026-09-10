/**
 * `doorman watch` classification.
 *
 * The consequential assertions are the two in "watch: what it must never say".
 * Everything else guards the matching that feeds them.
 *
 * This command reads a public feed and a private inventory and decides which
 * rows matter. It can be wrong in two directions and only one of them is
 * visible: telling you that you already have something you do not is annoying
 * and you will notice, while telling you a candidate is new when you already
 * run it wastes a paid grade and you will not.
 */

import { check, describe } from './harness.mjs';
import { classify, installedKeys, serverKey, WATCH_VERDICTS } from '../cli/watch.mjs';

const row = (over = {}) => ({
  server_url: 'https://mcp.example.com/mcp',
  grade: 'A',
  score: 90,
  hard_fail: null,
  layers: { static_pct: 90, behavioral_pct: null, guidance_pct: null },
  self_graded: false,
  is_fixture: false,
  ...over,
});

describe('watch: url matching');

check('host and path together, not host alone',
  serverKey('https://mcp.openzeppelin.com/contracts/cairo/mcp') !==
  serverKey('https://mcp.openzeppelin.com/contracts/stellar/mcp'),
  'openzeppelin publishes four servers on one host; keying on host reports three ' +
  'of them as already installed on the strength of the fourth');

check('a trailing slash is not a different server',
  serverKey('https://a.dev/mcp/') === serverKey('https://a.dev/mcp'));

check('case in the host does not matter',
  serverKey('https://A.DEV/mcp') === serverKey('https://a.dev/mcp'));

check('a null url has no key', serverKey(null) === null);
check('an empty string has no key', serverKey('') === null);
check('an unparseable url still yields something rather than throwing',
  typeof serverKey('not a url at all') === 'string');

describe('watch: what the build already has');

const inv = {
  mcpServers: [
    { name: 'deepwiki', url: 'https://mcp.deepwiki.com/mcp' },
    { name: 'derived-from-tool-names', url: null },      // no url to match on
  ],
  allowlisted: [{ key: 'exa', url: 'https://mcp.exa.ai/mcp', grade: 'A' }],
};
const keys = installedKeys(inv);

check('a configured server is known', keys.has(serverKey('https://mcp.deepwiki.com/mcp')));
check('an allowlisted server is known', keys.has(serverKey('https://mcp.exa.ai/mcp')));
check('a server with a null url contributes no key rather than a null one',
  !keys.has(null) && keys.size === 2,
  'servers derived from tool names have no url, and a null key would match every ' +
  'candidate whose url failed to parse');

describe('watch: classification');

check('a server this build already runs is already-installed',
  classify(row({ server_url: 'https://mcp.deepwiki.com/mcp' }), keys).verdict === 'already-installed');

check('a hard fail is blocked',
  classify(row({ hard_fail: 'injection-shaped content' }), keys).verdict === 'blocked');

check('an F is blocked even with no hard_fail recorded',
  classify(row({ grade: 'F', hard_fail: null }), keys).verdict === 'blocked');

check('the fixture is skipped, not blocked',
  classify(row({ is_fixture: true, grade: 'F' }), keys).verdict === 'skipped',
  'it IS hostile, deliberately, so blocking it would be technically right and ' +
  'useless: it is not a candidate for anyone');

check('a self-graded row is skipped',
  classify(row({ self_graded: true }), keys).verdict === 'skipped');

check('anything else is unreviewed',
  classify(row(), keys).verdict === 'unreviewed');

check('already-installed is decided BEFORE the grade',
  classify(row({ server_url: 'https://mcp.deepwiki.com/mcp', grade: 'F', hard_fail: 'x' }), keys)
    .verdict === 'already-installed',
  'a server you already run that has since been graded F is news about YOUR build, ' +
  'and filing it under "blocked" reads as advice about something you have not installed');

describe('watch: what it must never say');

check('no verdict claims the candidate FITS',
  !WATCH_VERDICTS.includes('fits'),
  'fits is fitReview\'s word and it needs a model to read the candidate against ' +
  'the build. A string match cannot earn it.');

check('the unreviewed reason does not claim usefulness',
  !/\bfits\b|would help|recommend|should adopt/i.test(classify(row(), keys).why),
  'this check established only that the build does not already have it');

check('every verdict returned is in the declared set',
  [row(), row({ hard_fail: 'x' }), row({ is_fixture: true }),
   row({ server_url: 'https://mcp.deepwiki.com/mcp' })]
    .every((c) => WATCH_VERDICTS.includes(classify(c, keys).verdict)));
