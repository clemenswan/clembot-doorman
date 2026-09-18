/**
 * The servers table on the dashboard: every reachable server, whether a human
 * decided on it, and what the last review measured.
 *
 * The page is the thing a person reads, so these assert on the rendered HTML,
 * not on an intermediate object a renderer could ignore.
 */

import { check, describe } from './harness.mjs';
import { renderDashboardHtml, serversSection } from '../cli/dashboard.mjs';

const res = {
  doctor: {
    servers: [
      { gateName: 'claude_ai_Notion', transport: 'claude.ai', target: null, sources: ['claude.ai account'] },
      { gateName: 'plugin_marketing_notion', transport: 'http', target: 'https://mcp.notion.com/mcp', sources: ['plugin:marketing (synced)'] },
      { gateName: 'plugin_marketing_canva', transport: 'http', target: 'https://mcp.canva.com/mcp', sources: ['plugin:marketing (synced)'] },
      { gateName: 'evil', transport: 'http', target: 'https://evil.example/mcp', sources: ['.mcp.json'] },
      { gateName: 'fresh', transport: 'http', target: 'https://fresh.example/mcp', sources: ['.mcp.json'] },
      { gateName: 'authed', transport: 'http', target: 'https://authed.example/mcp', sources: ['.mcp.json'] },
      { gateName: 'needstoken', transport: 'http', target: 'https://needstoken.example/mcp', sources: ['.mcp.json'] },
    ],
    gate: { allowed: ['claude_ai_Notion', 'plugin_marketing_canva'], denied: ['evil'] },
  },
};
const reviews = {
  'https://mcp.notion.com/mcp': { status: 'auth-required', reviewed_at: '2026-09-17T12:00:00Z' },
  'https://mcp.canva.com/mcp': { status: 'graded', band: 'A', score: 91.2, reviewed_at: '2026-09-17T12:00:00Z',
    static_partial: { reason: 'HTTP 401', coverage: { ran: 10, skipped: 68 } } },
  'https://evil.example/mcp': { status: 'graded', band: 'F', score: 20, hard_fail: 'steers the agent', reviewed_at: 't' },
  'https://authed.example/mcp': { status: 'graded', band: 'B', score: 74, reviewed_at: 't',
    authenticated: true, token_env: 'LINEAR_MCP_TOKEN' },
  'https://needstoken.example/mcp': { status: 'token-missing', reviewed_at: 't', authenticated: false,
    token_env: 'LINEAR_MCP_TOKEN',
    hint: '.doorman/tokens.json maps "needstoken" to LINEAR_MCP_TOKEN, which is not set in this environment.' },
};

describe('dashboard: servers table');
{
  const html = serversSection(res, reviews);
  const rowOf = (name) => html.split('<tr').find((r) => r.includes(`<code>${name}</code>`)) || '';

  check('every reachable server gets a row', ['claude_ai_Notion', 'plugin_marketing_notion', 'plugin_marketing_canva', 'evil', 'fresh']
    .every((n) => rowOf(n)));
  check('allowed, denied and undecided are told apart',
    /allowed/.test(rowOf('claude_ai_Notion')) && /denied/.test(rowOf('evil')) && /not decided/.test(rowOf('fresh')));
  check('a connector says why it has no review', /login live with your claude\.ai account/.test(rowOf('claude_ai_Notion')) && !/Grade/.test(rowOf('claude_ai_Notion')));
  check('a 401 reads as needs login, never as a grade', /login/.test(rowOf('plugin_marketing_notion')) && !/Grade/.test(rowOf('plugin_marketing_notion')));
  check('a partial grade prints PARTIAL and its coverage', /PARTIAL/.test(rowOf('plugin_marketing_canva')) && /10 of 78/.test(rowOf('plugin_marketing_canva')));
  check('a hard fail is shown', /steers the agent/.test(rowOf('evil')));
  check('never reviewed says so', /not reviewed/.test(rowOf('fresh')));
  // An authenticated grade and an anonymous one are over different surfaces.
  // A page that shows both as "Grade A" invites the exact comparison that
  // cannot be made.
  check('an anonymous grade is marked anonymous', /anonymous/.test(rowOf('plugin_marketing_canva')), rowOf('plugin_marketing_canva'));
  check('and an authenticated grade is marked authenticated',
    /authenticated/.test(rowOf('authed')) && !/anonymous/.test(rowOf('authed')), rowOf('authed'));
  check('a token-missing row says what to set, and is not a grade',
    /token-missing/.test(rowOf('needstoken')) && /LINEAR_MCP_TOKEN/.test(rowOf('needstoken'))
      && !/Grade/.test(rowOf('needstoken')), rowOf('needstoken'));
  check('the count line names the undecided total', /7 server\(s\)[^<]*4 not decided/.test(html), html.slice(0, 400));
}

describe('dashboard: no servers');
check('says there is nothing, rather than an empty table', /No MCP servers/.test(serversSection({ doctor: { servers: [], gate: {} } }, {})));

describe('dashboard: server names are escaped');
{
  const html = serversSection({ doctor: { servers: [{ gateName: '<img src=x>', transport: 'http', target: 'https://x/"><script>', sources: ['a'] }], gate: {} } }, {});
  check('no raw markup from a config file reaches the page', !html.includes('<img src=x>') && !html.includes('"><script>'));
}

describe('dashboard: a long server diff is a count, not forty lines');
{
  const many = Array.from({ length: 41 }, (_, i) => `s${i}`);
  const diff = { since: '2026-09-14', letterFrom: 'F', letterTo: 'F', pctFrom: 40, pctTo: 40, checks: [],
    gapsClosed: [], gapsOpened: [], serversAdded: many, serversRemoved: ['gone'] };
  const html = renderDashboardHtml({ root: '/p', timestamp: 't', doctor: { servers: [], gate: {} }, needs: {}, posture: {} },
    { letter: null, checks: [] }, diff);
  check('41 added collapses to one line', /41 servers added/.test(html) && (html.match(/server added:/g) || []).length === 0);
  check('a short list still names each one', /server removed: <code>gone<\/code>/.test(html));
}

describe('dashboard: a connector with a captured surface stops saying it cannot be reviewed');
{
  const surfaces = { claude_ai_Notion: { status: 'surface-reviewed', tools_scanned: 0, instructions_scanned: true,
    scanned_chars: 875, hard: 0, steering: 0, failure_modes: [] } };
  const html = serversSection(res, reviews, surfaces);
  const row = html.split('<tr').find((r) => r.includes('<code>claude_ai_Notion</code>')) || '';
  check('the row reports the captured surface instead', /captured surface/.test(row) && !/not reviewable here/.test(row), row.slice(0, 300));
  check('and still never claims a connection', /not connected/.test(row));
  const noCapture = serversSection(res, reviews, {}).split('<tr').find((r) => r.includes('<code>claude_ai_Notion</code>')) || '';
  check('the same connector with NO capture still says it cannot be reviewed locally',
    /not reviewable here/.test(noCapture) && !/captured surface/.test(noCapture), noCapture.slice(0, 200));
}

describe('dashboard: an advisory surface finding is shown without a grade colour');
{
  const surfaces = { claude_ai_Notion: { status: 'surface-reviewed', tools_scanned: 0, instructions_scanned: true,
    scanned_chars: 875, hard: 0, steering: 0, advisory: 2,
    failure_modes: ['commercial promotion (advisory, not scored) in server instructions (promotes-a-paid-tier): "..."'] } };
  const row = serversSection(res, reviews, surfaces).split('<tr').find((r) => r.includes('<code>claude_ai_Notion</code>')) || '';
  check('the finding is named as advisory', /advisory, not scored/.test(row), row.slice(0, 400));
  check('it does NOT read as clean', !/surface clean/.test(row));
  check('and carries no grade colour class', !/SURFACE: commercial promotion[^<]*<\/span>[\s\S]{0,0}/.test(row) || !/g-[FC]">SURFACE: commercial promotion/.test(row));
}
