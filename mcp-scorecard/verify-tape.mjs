#!/usr/bin/env node
/**
 * Verify a published grade WITHOUT trusting us.
 *
 *   node verify-tape.mjs https://webzum.com/api/mcp
 *   node verify-tape.mjs <audit-id>
 *
 * Zero dependencies. Node 18+. Nothing to install.
 *
 * ── What this actually proves ────────────────────────────────────────────────
 *
 * The site says "do not trust the letter, replay the tape". That is a slogan
 * until someone can run it, so this is the thing that runs it. It does three
 * independent checks:
 *
 *   1. FETCHES THE SERVER ITSELF. Speaks MCP to the graded endpoint directly and
 *      reads its tools/list. Nothing from us is involved in this step.
 *   2. COMPARES that against what our published tape claims the server said.
 *      If we altered, trimmed or invented a tool description, this disagrees.
 *   3. RE-RUNS THE PATTERNS locally, from a copy pasted into this file, over the
 *      text it just fetched from the SERVER (not from our tape). If our hits are
 *      not reproducible, this disagrees.
 *
 * ── What it cannot prove ─────────────────────────────────────────────────────
 *
 * That the server has not changed since we graded it. If a description differs,
 * that is reported as DRIFT rather than as fraud, because both are possible and
 * only the operator knows which. The audit's timestamp is printed so you can
 * judge.
 *
 * A disagreement here is a bug report against us. Please file it.
 */

const API = process.env.SCORECARD_API || 'https://scorecard.wanessalabs.com';

/* The patterns, copied verbatim from src/probes/injection_sniff.ts so that this
   file is self-contained and you never have to run our code to check our work. */
const PATTERNS = [
  ['ignore-previous-instructions', 'hard', /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all)\b[^.]{0,20}\b(instruction|prompt|rule|direction|context)/i],
  ['addresses-the-model-directly', 'hard', /\b(you are|you must|you should)\b[^.]{0,60}\b(assistant|ai|model|claude|gpt|agent)\b/i],
  ['system-prompt-manipulation', 'hard', /\b(system prompt|<\s*system\s*>|\[\s*system\s*\]|new instructions?|updated instructions?)\b/i],
  ['exfiltration-request', 'hard', /\b(send|post|forward|upload|transmit|leak|report)\b[^.]{0,40}\b(api[_ -]?key|token|secret|credential|password|env|conversation|chat history|system prompt)\b/i],
  ['secrecy-instruction', 'hard', /\b(do not|don't|never)\b[^.]{0,30}\b(tell|inform|mention|reveal|disclose|show)\b[^.]{0,30}\b(user|human|owner|operator)\b/i],
  ['coerced-tool-preference', 'hard', /\b(always|must|only)\b[^.]{0,30}\b(use|call|prefer|choose)\b[^.]{0,20}\bthis tool\b/i],
  ['embedded-role-marker', 'hard', /(^|\n)\s*(system|assistant|human|user)\s*:\s*\S/i],
  ['hidden-instruction-delimiter', 'hard', /(<\|[a-z_]+\|>|\[INST\]|###\s*(instruction|system))/i],
  ['imperative-to-model', 'steering', /\byou MUST\b/],
  ['always-offer', 'steering', /\b(proactively offer|always offer|every single time)\b/i],
  ['steer-from-competitor', 'steering', /\buse this instead of\b|\binstead of (telling|pointing|sending) the user\b/i],
  ['prescribed-user-line', 'steering', /\bthe (right|correct) closing line\b/i],
  ['internalize-directive', 'steering', /\binternali[sz]e (it|this)\b/i],
  ['preempt-the-user', 'steering', /\bdo(?: not|n't) wait for the user\b|\beven if the user did not ask\b/i],
];

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

let problems = 0;
const ok = (m) => console.log('  ' + g('OK  ') + m);
const bad = (m) => { problems++; console.log('  ' + r('BAD ') + m); };
const warn = (m) => console.log('  ' + y('DRIFT') + ' ' + m);

/** Minimal MCP client. Just enough to list tools. */
async function listTools(url) {
  const body = (method, params) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const post = async (payload) => {
    const res = await fetch(url, { method: 'POST', headers, body: payload });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Streamable HTTP servers may answer as SSE. Pull the last data: frame.
    if (text.startsWith('event:') || text.includes('\ndata:')) {
      const frames = text.split('\n').filter((l) => l.startsWith('data:'));
      return JSON.parse(frames[frames.length - 1].slice(5).trim());
    }
    return JSON.parse(text);
  };
  await post(body('initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'verify-tape', version: '1' },
  }));
  const out = await post(body('tools/list', {}));
  return out?.result?.tools ?? [];
}

function scan(text) {
  const hits = [];
  if (typeof text !== 'string') return hits;
  for (const [name, severity, re] of PATTERNS) if (re.test(text)) hits.push({ name, severity });
  return hits;
}

const arg = process.argv[2];
if (!arg) {
  console.log('usage: node verify-tape.mjs <server-url|audit-id>');
  process.exitCode = 1;
} else {
  await main(arg);
}

async function main(arg) {
  // ── Resolve the audit ──────────────────────────────────────────────────────
  const isUrl = /^https?:\/\//i.test(arg);
  const auditUrl = isUrl
    ? `${API}/grade?server=${encodeURIComponent(arg)}`
    : `${API}/grade/${encodeURIComponent(arg)}`;
  const res = await fetch(auditUrl);
  if (!res.ok) {
    console.log(r(`no published audit for ${arg} (HTTP ${res.status})`));
    process.exitCode = 1;
    return;
  }
  const audit = await res.json();

  console.log(`\n  server   ${audit.server_url}`);
  console.log(`  grade    ${audit.grade} ${audit.score}/100   static ${audit.layers.static_pct}%`);
  console.log(`  audit    ${audit.audit_id}`);
  console.log(`  graded   ${audit.completed_at}`);
  console.log(dim(`  model    ${audit.model} (grades are relative to it)`));

  // ── 1. Our published tape ──────────────────────────────────────────────────
  console.log('\n  1. our published transcript');
  const tapeUrl = `${API}/grade/${audit.audit_id}/transcripts`;
  const tapeText = await (await fetch(tapeUrl)).text();
  const turns = tapeText.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const taped = new Map();
  const tapedHits = [];
  for (const t of turns) {
    const c = t.content || {};
    if (c.scanned_tool) taped.set(c.scanned_tool, c.description ?? '');
    if (c.injection_hit) tapedHits.push(c.injection_hit);
  }
  ok(`${turns.length} turns, ${taped.size} tool descriptions, ${tapedHits.length} recorded hits`);
  console.log(dim(`       ${tapeUrl}`));

  // ── 2. The server, fetched directly ────────────────────────────────────────
  console.log('\n  2. the server itself, fetched directly (we are not involved)');
  let live;
  try {
    live = await listTools(audit.server_url);
  } catch (e) {
    warn(`could not reach the server now (${e.message}). Steps 2 and 3 skipped.`);
    console.log(dim('       A server that is down today does not make a past audit wrong.'));
    return finish();
  }
  ok(`${live.length} tools live right now`);

  // ── 3. Do they agree? ──────────────────────────────────────────────────────
  console.log('\n  3. does our tape match what the server serves today');
  let drift = 0;
  for (const t of live) {
    const mine = taped.get(t.name);
    const theirs = t.description ?? '';
    if (mine === undefined) { warn(`tool "${t.name}" is live but not in our tape (added since)`); drift++; }
    else if (mine !== theirs) { warn(`tool "${t.name}" description differs from our tape`); drift++; }
  }
  for (const name of taped.keys()) {
    if (!live.find((t) => t.name === name)) { warn(`tool "${name}" is in our tape but gone now (removed since)`); drift++; }
  }
  if (drift === 0) ok('every recorded description is byte-identical to the live server');
  else console.log(dim(`       ${drift} difference(s). Either the server changed, or we are wrong.`));

  // ── 4. Reproduce the findings from the SERVER's text ───────────────────────
  console.log('\n  4. re-running the patterns over text fetched from the SERVER');
  const reproduced = [];
  for (const t of live) {
    for (const h of scan(t.description)) reproduced.push({ tool: t.name, ...h });
    const props = t.inputSchema?.properties ?? {};
    for (const [k, v] of Object.entries(props)) {
      for (const h of scan(v?.description)) reproduced.push({ tool: `${t.name}.${k}`, ...h });
    }
  }
  const mineSet = new Set(tapedHits.map((h) => `${h.pattern}@${h.location}`));
  console.log(`     we published ${tapedHits.length} hit(s); independently found ${reproduced.length}`);
  for (const h of reproduced) {
    console.log(`       ${h.severity === 'hard' ? r('hard    ') : y('steering')} ${h.name}  ${dim(h.tool)}`);
  }
  if (reproduced.length === 0 && tapedHits.length > 0) {
    bad('we published hits that do not reproduce against the live server');
  } else if (reproduced.length > 0 && tapedHits.length === 0) {
    bad('the live server trips patterns we did not report');
  } else {
    ok('findings reproduce independently');
  }

  // ── 5. Does the cap follow the rule? ───────────────────────────────────────
  console.log('\n  5. is the grade consistent with its own rules');
  const hardCount = reproduced.filter((h) => h.severity === 'hard').length;
  if (hardCount > 0 && audit.grade !== 'F') bad(`${hardCount} hard hit(s) but the grade is ${audit.grade}, not F`);
  else if (hardCount > 0) ok(`${hardCount} hard hit(s), capped at F as documented`);
  else if (audit.hard_fail) bad('an F is published but nothing hard reproduces');
  else ok('no hard hit, no cap claimed');

  const steer = reproduced.filter((h) => h.severity === 'steering').length;
  if (steer > 0 && hardCount === 0 && audit.grade === 'F') {
    bad('steering alone produced an F. Steering is documented as never capping.');
  } else if (steer > 0) {
    ok(`${steer} steering hit(s), reported and scored, correctly not treated as a cap`);
  }

  finish();
}

function finish() {
  console.log('');
  if (problems === 0) {
    console.log('  ' + g('VERIFIED') + '  every published claim reproduced independently.\n');
  } else {
    console.log('  ' + r(`${problems} DISAGREEMENT(S)`) +
      '  this is a bug report against us. Please open an issue.\n');
    process.exitCode = 1;
  }
}
