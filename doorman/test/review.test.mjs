/**
 * `doorman review`: the static report, run over every server doctor found.
 *
 * Offline. `reportImpl` is injected, so nothing here reaches a server. The
 * failure strings are the ones the runner really printed on 2026-09-17: the
 * 401 from mcp.notion.com, and the ERR_MODULE_NOT_FOUND a fresh clone gives
 * before `npm run build:shared`. Both were reported as "mcpscore is not on
 * PATH", which was true of neither.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import { diagnose, readReviews, reviewServers } from '../cli/review.mjs';

const NOTION_401 = 'error: MCP initialize HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}';
const NO_LIB = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\x\\mcp-scorecard\\runner\\lib.mjs' imported from C:\\x\\mcp-scorecard\\runner\\audit.mjs";

describe('review: a failed runner is diagnosed, not guessed at');
check('401 is auth-required', diagnose(NOTION_401).status === 'auth-required');
check('403 is auth-required', diagnose('MCP initialize HTTP 403: forbidden').status === 'auth-required');
check('unbuilt lib.mjs names the build step', diagnose(NO_LIB).status === 'runner-not-built'
  && /build:shared/.test(diagnose(NO_LIB).hint));
check('mcpscore missing is still recognised', diagnose('Error: spawn mcpscore ENOENT').status === 'mcpscore-missing');
check('anything else is failed, with no invented cause', diagnose('socket hang up').status === 'failed'
  && diagnose('socket hang up').hint === null);

describe('review: one run per url, every server gets a row');
{
  const root = mkdtempSync(join(tmpdir(), 'review-'));
  const calls = [];
  const reportImpl = async ({ link }) => {
    calls.push(link);
    if (link.includes('notion')) return { ok: false, why: 'the runner produced no grade.json', detail: NOTION_401 };
    return { ok: true, grade: { band: 'A', score: 85.71, hard_fail: null, static_partial: null, graded_at: '2026-09-17T00:00:00Z' } };
  };
  const servers = [
    { gateName: 'plugin_marketing_notion', transport: 'http', target: 'https://mcp.notion.com/mcp' },
    { gateName: 'plugin_product-management_notion', transport: 'http', target: 'https://mcp.notion.com/mcp' },
    { gateName: 'plugin_marketing_canva', transport: 'http', target: 'https://mcp.canva.com/mcp' },
    { gateName: 'claude_ai_Notion', transport: 'claude.ai', target: null },
    { gateName: 'localtool', transport: 'stdio', target: 'node' },
  ];
  const r = await reviewServers(root, { servers, reportImpl, log: () => {}, now: () => '2026-09-17T12:00:00Z' });

  check('the same url is reported once', calls.length === 2, calls.join(', '));
  check('a graded server keeps its band and score',
    r.reviews['https://mcp.canva.com/mcp'].status === 'graded' && r.reviews['https://mcp.canva.com/mcp'].band === 'A');
  check('a 401 is recorded as auth-required, with no band',
    r.reviews['https://mcp.notion.com/mcp'].status === 'auth-required' && !('band' in r.reviews['https://mcp.notion.com/mcp']));
  check('a connector is not reviewable and says why',
    r.skipped.some((s) => s.gateName === 'claude_ai_Notion' && /claude\.ai/.test(s.why)));
  check('a stdio server is not run: review never executes a local command',
    r.skipped.some((s) => s.gateName === 'localtool' && /stdio/.test(s.why)));

  const back = readReviews(root);
  check('reviews persist for the dashboard', back['https://mcp.canva.com/mcp']?.reviewed_at === '2026-09-17T12:00:00Z');
}

describe('review: a partial static layer stays partial');
{
  const root = mkdtempSync(join(tmpdir(), 'review-'));
  const reportImpl = async () => ({ ok: true, grade: { band: 'A', score: 100, hard_fail: null,
    static_partial: { reason: 'HTTP 401', coverage: { ran: 10, skipped: 68 } } } });
  const r = await reviewServers(root, {
    servers: [{ gateName: 'x', transport: 'http', target: 'https://x.example/mcp' }],
    reportImpl, log: () => {}, now: () => 't',
  });
  check('partial is carried into the record', r.reviews['https://x.example/mcp'].static_partial?.coverage?.ran === 10);
}

describe('review: nothing on disk yet');
check('readReviews on a fresh project is {}', Object.keys(readReviews(mkdtempSync(join(tmpdir(), 'review-')))).length === 0);
