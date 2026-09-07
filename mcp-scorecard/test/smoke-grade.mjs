#!/usr/bin/env node
/**
 * Smoke test: grade a REAL public MCP server and assert a numeric score.
 *
 * This is not a unit test and it does not mock anything. It runs mcpscore
 * against a live server, speaks MCP to it, computes a grade with the same code
 * the Worker uses, and fails loudly if the score is not a real number in range.
 *
 * Network-dependent by design. It answers the one question the unit tests
 * cannot: does this actually work against something we did not write?
 *
 *   node test/smoke-grade.mjs [server-url]
 *
 * Requires mcpscore on PATH. Runs static-only unless ANTHROPIC_API_KEY is set,
 * so it is safe and free to run in a loop.
 */

import { runAudit } from '../runner/audit.mjs';

const SERVER = process.argv[2] ?? 'https://mcp.deepwiki.com/mcp';
const apiKey = process.env.ANTHROPIC_API_KEY;
const behavioural = Boolean(apiKey) && process.env.SMOKE_BEHAVIOURAL === '1';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ' - ' + detail : ''}`);
    failures++;
  }
}

console.log(`\nsmoke: grading ${SERVER}`);
console.log(`       behavioural probes: ${behavioural ? 'ON' : 'off (set ANTHROPIC_API_KEY and SMOKE_BEHAVIOURAL=1)'}\n`);

const started = Date.now();
let result;
try {
  result = await runAudit(
    {
      audit_id: 'smoke-' + Date.now(),
      server_url: SERVER,
      needed_for: 'look up how a public GitHub repository works',
      model: 'claude-sonnet-5',
      temperature: 0,
      runs: behavioural ? 3 : 0,
    },
    { apiKey, log: (m) => console.log('       ' + m), skipBehavioral: !behavioural },
  );
} catch (e) {
  console.error(`\n  FATAL  audit threw: ${e.message}\n`);
  process.exit(1);
}

const g = result.grade;
console.log('');

// The assertion the spec actually asks for.
check('score is a number', typeof g.score === 'number', typeof g.score);
check('score is not NaN', Number.isFinite(g.score), String(g.score));
check('score is within 0-100', g.score >= 0 && g.score <= 100, String(g.score));
check('band is one of A/B/C/F', ['A', 'B', 'C', 'F'].includes(g.band), g.band);

// A band that disagrees with its own score would make every published grade
// meaningless, so check the two against each other rather than in isolation.
const expected = g.score >= 85 ? 'A' : g.score >= 70 ? 'B' : g.score >= 50 ? 'C' : 'F';
check(
  'band matches the score',
  g.hard_fail ? g.band === 'F' : g.band === expected,
  `score ${g.score} -> expected ${expected}, got ${g.band}`,
);

check('static layer was measured', typeof g.layers.static.pct === 'number', JSON.stringify(g.layers.static));
check('static pct is within 0-100', g.layers.static.pct >= 0 && g.layers.static.pct <= 100);
check('mcpscore version recorded', Boolean(g.mcpscore_version), g.mcpscore_version);
check('model recorded on the grade', Boolean(g.model), g.model);

check('evidence hash is a sha-256', /^[0-9a-f]{64}$/.test(result.evidence_sha256 ?? ''), result.evidence_sha256);
check('report is non-empty', (result.report_md ?? '').length > 100);
check('report fits one page', result.report_md.split('\n').length <= 64,
  `${result.report_md.split('\n').length} lines`);
check('recipe is non-empty', (result.recipe_md ?? '').length > 40);
check('report names the model', result.report_md.includes(g.model) || !behavioural);

if (behavioural) {
  const scored = Object.entries(g.probe_scores).filter(([, s]) => s !== null);
  check('at least one behavioural probe ran', scored.length > 0);
  check('behavioural layer was measured', typeof g.layers.behavioral.pct === 'number');
  check('transcripts were captured', result.transcripts.length > 0);
  check(
    'every transcript is non-empty',
    result.transcripts.every((t) => t.jsonl.length > 0),
  );
}

console.log(`\n  grade: ${g.band} ${g.score}/100   (${((Date.now() - started) / 1000).toFixed(1)}s)`);
console.log(`  ${failures === 0 ? 'SMOKE PASSED' : `SMOKE FAILED (${failures})`}\n`);

/*
 * exitCode, NEVER process.exit().
 *
 * On Node 25 / Windows, calling process.exit() while undici still holds
 * keep-alive sockets open trips a libuv assertion during teardown:
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:76
 *
 * The crash happens AFTER the exit code is chosen and replaces it with 127.
 * This test printed "SMOKE PASSED" and exited 127, which would have made any
 * CI gate permanently and inexplicably red. Setting exitCode lets Node drain
 * its handles and exit honestly.
 */
process.exitCode = failures === 0 ? 0 : 1;
