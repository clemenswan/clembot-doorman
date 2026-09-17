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
    ],
    gate: { allowed: ['claude_ai_Notion', 'plugin_marketing_canva'], denied: ['evil'] },
  },
};
const reviews = {
  'https://mcp.notion.com/mcp': { status: 'auth-required', reviewed_at: '2026-09-17T12:00:00Z' },
  'https://mcp.canva.com/mcp': { status: 'graded', band: 'A', score: 91.2, reviewed_at: '2026-09-17T12:00:00Z',
    static_partial: { reason: 'HTTP 401', coverage: { ran: 10, skipped: 68 } } },
  'https://evil.example/mcp': { status: 'graded', band: 'F', score: 20, hard_fail: 'steers the agent', reviewed_at: 't' },
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
  check('the count line names the undecided total', /5 server\(s\)[^<]*2 not decided/.test(html), html.slice(0, 400));
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
