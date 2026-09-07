#!/usr/bin/env node
/**
 * Smoke test: the Worker HTTP surface, end to end.
 *
 * Exercises the real request path against a running `wrangler dev`, including
 * the full runner round trip: enqueue -> claim -> post result -> read back.
 * That round trip is the seam the whole architecture rests on, and it is not
 * covered by any unit test.
 *
 *   npx wrangler dev --port 8799 --local
 *   node test/smoke-api.mjs [base-url]
 */

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8799').replace(/\/+$/, '');
const TOKEN = process.env.RUNNER_TOKEN ?? 'local-dev-token-not-a-secret';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    console.log(`  FAIL  ${name}${detail ? ' - ' + detail : ''}`);
    failures++;
  }
}

const get = (p, opts) => fetch(BASE + p, opts);
const post = (p, body, opts = {}) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify(body),
  });

console.log(`\nsmoke: worker api at ${BASE}\n`);

// --- health + spec ---------------------------------------------------------
{
  const r = await get('/health');
  const j = await r.json();
  check('GET /health is 200', r.status === 200, String(r.status));
  check('health reports the pinned model', Boolean(j.model), JSON.stringify(j));
}
{
  const r = await get('/openapi.json');
  const j = await r.json();
  check('GET /openapi.json is 200', r.status === 200);
  check('spec is OpenAPI 3.1', j.openapi === '3.1.0', j.openapi);
  for (const p of ['/grade', '/grade/{audit_id}', '/grade/{audit_id}/transcripts',
                   '/badge/{server}.svg', '/api/ledger']) {
    check(`spec documents ${p}`, Boolean(j.paths?.[p]));
  }
  check('spec declares the runner security scheme',
    Boolean(j.components?.securitySchemes?.runnerToken));
}

// --- validation ------------------------------------------------------------
{
  const r = await post('/grade', { url: 'http://insecure.example.com/mcp' });
  check('POST /grade rejects plaintext http', r.status === 400, String(r.status));
}
{
  const r = await post('/grade', { url: 'not a url' });
  check('POST /grade rejects a malformed url', r.status === 400, String(r.status));
}
{
  const r = await post('/grade', {});
  check('POST /grade rejects a body with no url', r.status === 400, String(r.status));
}

// --- auth ------------------------------------------------------------------
{
  const r = await get('/api/pending');
  check('GET /api/pending requires a token', r.status === 401, String(r.status));
}
{
  const r = await get('/api/pending', { headers: { authorization: 'Bearer wrong-token' } });
  check('GET /api/pending rejects a wrong token', r.status === 401, String(r.status));
}

// --- the round trip --------------------------------------------------------
const SERVER = 'https://mcp.deepwiki.com/mcp';
let auditId;
{
  const r = await post('/grade', {
    name: 'DeepWiki', url: SERVER, needed_for: 'look up how a repo works',
  });
  const j = await r.json();
  check('POST /grade returns 202 (async, not a lie about being sync)', r.status === 202, String(r.status));
  auditId = j.audits?.[0]?.audit_id;
  check('POST /grade returns an audit id', Boolean(auditId), JSON.stringify(j).slice(0, 200));
  check('POST /grade returns a poll url', Boolean(j.audits?.[0]?.poll));
}
{
  const r = await get(`/grade/${auditId}`);
  const j = await r.json();
  check('GET /grade/{id} finds the queued audit', r.status === 200, String(r.status));
  check('queued audit has status "queued"', j.status === 'queued', j.status);
  check('queued audit has no grade yet', j.grade === null, String(j.grade));
}
{
  const r = await get('/api/pending?limit=1&runner=smoke', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const j = await r.json();
  check('a runner can claim the queued work', j.claimed === 1, JSON.stringify(j).slice(0, 200));
  check('claimed work carries the server url', j.work?.[0]?.server_url === SERVER);
  check('claimed work carries the pinned model', Boolean(j.work?.[0]?.model));
}
{
  // Claiming again must NOT hand the same row to a second runner.
  const r = await get('/api/pending?limit=1&runner=smoke2', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const j = await r.json();
  check('a second runner does not get the same claimed row', j.claimed === 0, JSON.stringify(j));
}
{
  const r = await post('/api/result', {
    audit_id: auditId,
    status: 'complete',
    server_name: 'DeepWiki',
    grade: {
      band: 'B', score: 74.5, hard_fail: null, mcpscore_version: '1.11.0',
      layers: { static: { pct: 85.71 }, behavioral: { pct: 66 }, guidance: { pct: null } },
    },
    grade_json: { band: 'B', score: 74.5 },
    report_md: '# DeepWiki - Grade B',
    recipe_md: '# Recipe',
    evidence_sha256: 'a'.repeat(64),
    transcripts: [{ probe_id: 'cold_open', run_index: 0, score: 70, jsonl: '{"role":"user"}' }],
  }, { headers: { authorization: `Bearer ${TOKEN}` } });
  check('a runner can post a result', r.status === 200, String(r.status));
}
{
  const r = await post('/api/result', { audit_id: auditId, status: 'complete' },
    { headers: { authorization: `Bearer ${TOKEN}` } });
  check('a result with no score is rejected', r.status === 400, String(r.status));
}
{
  const r = await get(`/grade/${auditId}`);
  const j = await r.json();
  check('audit is now complete', j.status === 'complete', j.status);
  check('grade was stored', j.grade === 'B', String(j.grade));
  check('score was stored as a number', j.score === 74.5, String(j.score));
  check('layers were stored', j.layers?.static_pct === 85.71, JSON.stringify(j.layers));
  check('unmeasured guidance stayed null, not zero', j.layers?.guidance_pct === null,
    String(j.layers?.guidance_pct));
  check('evidence hash was stored', /^[0-9a-f]{64}$/.test(j.evidence_sha256 ?? ''));
}

// --- the tape ---------------------------------------------------------------
// Transcripts have been stored since day one; until this endpoint existed
// nothing could read one back, so "replay the tape" was only true if you were
// the runner. These assertions are the difference.
{
  const r = await get(`/grade/${auditId}/transcripts`);
  const body = await r.text();
  check('GET /grade/{id}/transcripts is 200', r.status === 200, String(r.status));
  check('transcript is ndjson',
    (r.headers.get('content-type') ?? '').includes('application/x-ndjson'),
    r.headers.get('content-type') ?? '');
  check('transcript returns the stored turn verbatim', body.includes('{"role":"user"}'), body.slice(0, 120));
  check('transcript reports how many runs it covers',
    r.headers.get('x-transcript-runs') === '1', r.headers.get('x-transcript-runs') ?? '');
  check('the tape needs no token', !body.includes('Unauthorized'));
}
{
  const r = await get(`/grade/${auditId}/transcripts?format=json`);
  const j = await r.json();
  check('format=json groups turns by run', Array.isArray(j.runs) && j.runs.length === 1,
    JSON.stringify(j).slice(0, 160));
  check('grouped run names its probe', j.runs?.[0]?.probe_id === 'cold_open', String(j.runs?.[0]?.probe_id));
  check('grouped run parses its turns', j.runs?.[0]?.turns?.[0]?.role === 'user',
    JSON.stringify(j.runs?.[0]?.turns ?? []).slice(0, 120));
}
{
  const r = await get('/grade/no-such-audit-id/transcripts');
  check('transcripts 404 on an unknown audit', r.status === 404, String(r.status));
}
{
  const r = await get(`/grade?server=${encodeURIComponent(SERVER)}`);
  const j = await r.json();
  check('GET /grade?server= finds the cached grade', r.status === 200, String(r.status));
  check('cached read reports graded:true', j.graded === true);
  check('a fresh grade is not marked stale', j.stale === false, String(j.stale));
}
{
  const r = await get('/api/pending?limit=1&runner=smoke3', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const j = await r.json();
  check('a completed audit leaves the pending queue', j.claimed === 0, JSON.stringify(j));
}

// --- the scorecard as an MCP server -----------------------------------------
// Deliberately AFTER the pending-queue check above: the grade tool queues a
// real audit for the never-graded url, and a pending row created here would
// make that assertion fail on this suite's own side effect.
// The doorman subagent's only tool lives here. Until this endpoint existed the
// agent at the centre of the demo declared a tool nothing served.
const rpc = (msg) => post('/mcp', msg);
{
  const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {},
              clientInfo: { name: 'smoke', version: '0' } } });
  const j = await r.json();
  check('MCP initialize is 200', r.status === 200, String(r.status));
  check('MCP negotiates a protocol version', Boolean(j.result?.protocolVersion),
    JSON.stringify(j).slice(0, 160));
  check('MCP names the server', j.result?.serverInfo?.name === 'mcp-scorecard',
    String(j.result?.serverInfo?.name));
  check('MCP instructions warn that grading is async',
    (j.result?.instructions ?? '').includes('asynchronous'),
    (j.result?.instructions ?? '').slice(0, 80));
}
{
  const r = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  check('MCP notification gets 202 and no body', r.status === 202, String(r.status));
}
{
  const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const j = await r.json();
  check('MCP lists exactly one tool', j.result?.tools?.length === 1,
    JSON.stringify(j.result?.tools?.map((t) => t.name) ?? []));
  check('the one tool is grade', j.result?.tools?.[0]?.name === 'grade');
  check('the tool schema requires a url',
    (j.result?.tools?.[0]?.inputSchema?.required ?? []).includes('url'));
}
{
  // The cached path. SERVER was graded earlier in this run, so this must
  // answer with the grade rather than queueing a duplicate audit.
  const r = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'grade', arguments: { url: SERVER, needed_for: 'smoke' } } });
  const j = await r.json();
  const payload = j.result?.structuredContent;
  check('MCP grade answers from cache', payload?.graded === true, JSON.stringify(payload).slice(0, 160));
  check('cached answer carries the grade', payload?.grade === 'B', String(payload?.grade));
  check('cached answer links the evidence',
    String(payload?.transcripts ?? '').includes('/transcripts'), String(payload?.transcripts));
}
{
  // The uncached path must never invent a number.
  const r = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'grade', arguments: { url: 'https://never-graded.example.com/mcp' } } });
  const j = await r.json();
  const payload = j.result?.structuredContent;
  check('an ungraded server comes back graded:false', payload?.graded === false,
    JSON.stringify(payload).slice(0, 160));
  check('an ungraded server returns no grade field', payload?.grade === undefined,
    String(payload?.grade));
  check('an ungraded server returns an audit id to poll', Boolean(payload?.audit_id));
}
{
  const r = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'grade', arguments: { url: 'http://plaintext.example.com/mcp' } } });
  const j = await r.json();
  check('MCP refuses a plaintext endpoint', j.result?.isError === true,
    JSON.stringify(j.result).slice(0, 160));
  check('the refusal says why', (j.result?.content?.[0]?.text ?? '').includes('https'),
    (j.result?.content?.[0]?.text ?? '').slice(0, 100));
}
{
  const r = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call',
    params: { name: 'grade', arguments: {} } });
  const j = await r.json();
  check('a missing url is a tool error, not a crash', j.result?.isError === true);
  check('the error names the argument and its type',
    (j.result?.content?.[0]?.text ?? '').includes('"url" (string)'),
    (j.result?.content?.[0]?.text ?? '').slice(0, 100));
}
{
  const r = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'delete_everything', arguments: {} } });
  const j = await r.json();
  check('an unknown tool is refused', j.result?.isError === true);
  check('the refusal states there is exactly one tool',
    (j.result?.content?.[0]?.text ?? '').includes('exactly one'),
    (j.result?.content?.[0]?.text ?? '').slice(0, 100));
}

// --- badges ----------------------------------------------------------------
{
  const r = await get(`/badge/${encodeURIComponent(SERVER)}.svg`);
  const svg = await r.text();
  check('badge is 200', r.status === 200, String(r.status));
  check('badge is SVG', (r.headers.get('content-type') ?? '').includes('image/svg+xml'));
  check('badge shows the grade', svg.includes('B 74.5'), svg.slice(0, 120));
}
{
  const r = await get('/badge/https%3A%2F%2Fnever-graded.example.com%2Fmcp.svg');
  const svg = await r.text();
  check('an ungraded server gets an explicit ungraded badge', svg.includes('ungraded'));
  check('ungraded badge does not imply a letter', !/>\s*[ABCF]\s*</.test(svg));
}

// --- ledger ----------------------------------------------------------------
{
  const r = await get('/api/ledger?limit=10');
  const j = await r.json();
  check('ledger is 200', r.status === 200);
  check('ledger recorded the queue and grade events',
    j.entries.some((e) => e.event === 'queued') && j.entries.some((e) => e.event === 'graded'),
    JSON.stringify(j.entries.map((e) => e.event)));
  check('ledger reports totals for the demo site', typeof j.totals?.audits === 'number',
    JSON.stringify(j.totals));
  check('ledger is not cached', (r.headers.get('cache-control') ?? '').includes('no-store'));
}

// --- 404 -------------------------------------------------------------------
{
  const r = await get('/grade/does-not-exist');
  check('unknown audit is 404', r.status === 404, String(r.status));
}
{
  const r = await get('/nope');
  check('unknown route is 404', r.status === 404, String(r.status));
}

console.log(`\n  ${failures === 0 ? 'API SMOKE PASSED' : `API SMOKE FAILED (${failures})`}\n`);
// exitCode, never process.exit(): see test/smoke-grade.mjs for why.
process.exitCode = failures === 0 ? 0 : 1;
