/**
 * Tests for the doorman CLI: the task parser, the verdict rules, and the
 * install-layer derivation.
 *
 * Same dependency-free spirit as test/run.mjs. Nothing here touches Docker or a
 * model: the pieces that do are the ones a test cannot honestly assert without
 * a key, and inventing a fake for them would test the fake.
 */

import { parseTaskYaml, validateTask, TaskParseError } from '../cli/task.mjs';
import { decide, summariseArm, securityOverride, MIN_RUNS_FOR_ADOPT } from '../cli/verdict.mjs';
import { installLayer } from '../cli/sandbox.mjs';
import { estimateEval, priceFor, worstCaseRunUsd } from '../cli/cost.mjs';
import { turnsWithinBudget } from '../cli/eval.mjs';
import { ADAPTERS, credentialCheck, resolveAdapter, unmeasured } from '../cli/agents.mjs';
import { doctor, renderDoctor } from '../cli/doctor.mjs';

let pass = 0, fail = 0;
const results = [];
const pending = [];
function it(name, fn) {
  // Some checks are async now (doctor reads the filesystem). Collect the
  // promise rather than losing the failure: a rejected promise nobody awaits
  // is a test that silently passes.
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(() => { pass++; results.push(['PASS', name]); },
                          (e) => { fail++; results.push(['FAIL', name + ' :: ' + e.message]); }));
    } else { pass++; results.push(['PASS', name]); }
  } catch (e) { fail++; results.push(['FAIL', name + ' :: ' + e.message]); }
}
const eq = (a, b, m = '') => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${m} expected ${B}, got ${A}`);
};
const truthy = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const throws = (fn, m) => {
  try { fn(); } catch { return; }
  throw new Error(m || 'expected a throw');
};

/* ── the parser refuses rather than guessing ──────────────────────────── */

it('parses the supported subset', () => {
  const t = parseTaskYaml([
    '# a comment',
    'id: demo',
    'title: A demo',
    'runs: 3',
    'network: false',
    'prompt: |',
    '  line one',
    '  line two',
    'success:',
    '  file_exists: out.md',
    '  contains:',
    '    - alpha',
    '    - beta',
  ].join('\n'));
  eq(t.id, 'demo');
  eq(t.runs, 3);
  eq(t.network, false);
  eq(t.prompt, 'line one\nline two');
  eq(t.success.contains, ['alpha', 'beta']);
});

it('REFUSES anchors, aliases and tags rather than silently dropping them', () => {
  for (const bad of ['a: &anchor x', 'a: *alias', 'a: !!str x']) {
    throws(() => parseTaskYaml(bad), `should have refused: ${bad}`);
  }
});

it('REFUSES tabs, odd indentation and duplicate keys', () => {
  throws(() => parseTaskYaml('a:\n\tb: 1'), 'tabs');
  throws(() => parseTaskYaml('a:\n   b: 1'), 'three-space indent');
  throws(() => parseTaskYaml('a: 1\na: 2'), 'duplicate key');
});

it('REFUSES a key that opens a block with nothing under it', () => {
  // Almost always a truncated file. Reading it as an empty object would produce
  // a task that parses, validates differently, and means something else.
  throws(() => parseTaskYaml('id: x\nsuccess:\n'), 'empty block');
});

it('reports the line number, because a parser that says "invalid" is useless', () => {
  try {
    parseTaskYaml('id: ok\ntitle: ok\n\tbroken: 1');
    throw new Error('should have thrown');
  } catch (e) {
    truthy(e instanceof TaskParseError, 'wrong error type');
    truthy(typeof e.line === 'number' && e.line > 0, 'no line number');
  }
});

it('does not treat a document marker as content', () => {
  throws(() => parseTaskYaml('---\nid: x'), 'document marker');
});

/* ── validation insists success is machine-checkable ──────────────────── */

it('rejects a task whose success has no checkable condition', () => {
  const p = validateTask({ id: 'a', title: 'b', category: 'c', prompt: 'x'.repeat(30), success: { vibes: true } });
  truthy(p.some((m) => m.includes('machine-checkable')), 'expected the checkable-condition complaint');
});

it('accepts file_exists, contains or sections', () => {
  for (const s of [{ file_exists: 'a.md' }, { contains: 'x' }, { sections: 3 }]) {
    eq(validateTask({ id: 'a', title: 'b', category: 'c', prompt: 'x'.repeat(30), success: s }), []);
  }
});

it('rejects an out-of-range runs value', () => {
  const p = validateTask({ id: 'a', title: 'b', category: 'c', prompt: 'x'.repeat(30), success: { contains: 'x' }, runs: 99 });
  truthy(p.some((m) => m.includes('runs')), 'expected a runs complaint');
});

/* ── the verdict is conservative in exactly one direction ─────────────── */

const arm = (n, successes, extra = {}) =>
  summariseArm(Array.from({ length: n }, (_, i) => ({
    success: i < successes, turns: 5, tool_calls: 3, tokens: 1000, cost_usd: 0.01, wall_ms: 1000, ...extra,
  })));

it('one run per arm can NEVER be ADOPT', () => {
  const r = decide({ baseline: arm(1, 0), candidate: arm(1, 1) });
  eq(r.verdict, 'INCONCLUSIVE');
  truthy(r.reasons[0].includes('noise'), 'should say why');
});

it('but one run per arm CAN still DECLINE', () => {
  // The reason a cheap eval is worth running at all.
  const r = decide({ baseline: arm(1, 1), candidate: arm(1, 0) });
  eq(r.verdict, 'DECLINE');
});

it('ADOPTs on a real success gain at the minimum run count', () => {
  const r = decide({ baseline: arm(MIN_RUNS_FOR_ADOPT, 1), candidate: arm(MIN_RUNS_FOR_ADOPT, 3) });
  eq(r.verdict, 'ADOPT');
});

it('ADOPTs on equal success when materially cheaper', () => {
  const base = arm(3, 3);
  const cand = summariseArm(Array.from({ length: 3 }, () => ({
    success: true, turns: 3, tool_calls: 2, tokens: 500, cost_usd: 0.005, wall_ms: 900,
  })));
  eq(decide({ baseline: base, candidate: cand }).verdict, 'ADOPT');
});

it('DECLINEs equal success that costs materially more', () => {
  const base = arm(3, 3);
  const cand = summariseArm(Array.from({ length: 3 }, () => ({
    success: true, turns: 9, tool_calls: 6, tokens: 3000, cost_usd: 0.03, wall_ms: 3000,
  })));
  const r = decide({ baseline: base, candidate: cand });
  eq(r.verdict, 'DECLINE');
});

it('says INCONCLUSIVE when nothing moved, and calls that a finding', () => {
  const r = decide({ baseline: arm(3, 3), candidate: arm(3, 3) });
  eq(r.verdict, 'INCONCLUSIVE');
  truthy(r.note.includes('never promotes'), 'must state that it does not promote');
});

it('a security signal DECLINEs regardless of perfect numbers', () => {
  const r = decide({
    baseline: arm(5, 0),
    candidate: arm(5, 5),
    observations: { undeclared_network: ['telemetry.example.com'] },
  });
  eq(r.verdict, 'DECLINE');
  eq(r.confidence, 'high');
  truthy(r.reasons[0].startsWith('SECURITY:'), 'should be flagged as security');
  truthy(r.deltas === null, 'must not present deltas as if they were weighed');
});

it('securityOverride is quiet when there is nothing to report', () => {
  eq(securityOverride({}), []);
  eq(securityOverride({ undeclared_network: [] }), []);
});

it('means are over successful runs only', () => {
  const s = summariseArm([
    { success: true, turns: 4, tokens: 100, cost_usd: 0.01, wall_ms: 10 },
    { success: false, turns: 99, tokens: 9999, cost_usd: 9.99, wall_ms: 9999 },
  ]);
  eq(s.mean_turns, 4, 'a failed run must not inflate the mean');
  eq(s.success_rate, 0.5);
});

/* ── install layer: one reproducible RUN, or a refusal ────────────────── */

it('derives npm, pip and git layers', () => {
  eq(installLayer('npm:left-pad').kind, 'npm');
  eq(installLayer('https://www.npmjs.com/package/got').spec, 'got');
  eq(installLayer('pip:crawl4ai').kind, 'pip');
  eq(installLayer('https://pypi.org/project/crawl4ai/').spec, 'crawl4ai');
  eq(installLayer('https://github.com/sindresorhus/got').kind, 'git');
  eq(installLayer('https://github.com/sindresorhus/got.git').spec, 'sindresorhus/got');
});

it('REFUSES a link it cannot express as one layer, and says why', () => {
  const r = installLayer('https://mcp.deepwiki.com/mcp');
  eq(r.kind, 'unsupported');
  truthy(r.run === null, 'must not invent an install command');
  truthy(r.why.includes('doorman report'), 'should point at the layer that does work');
});

/* ── cost: the ceiling has to bind, and be derived from arithmetic ────── */

it('cost grows with the SQUARE of the turn count, not linearly', () => {
  // The reason MAX_TURNS alone was never a budget. Doubling the turns much more
  // than doubles the bill, because every turn resends the whole conversation.
  const a = worstCaseRunUsd('claude-sonnet-5', { maxTurns: 6 });
  const b = worstCaseRunUsd('claude-sonnet-5', { maxTurns: 12 });
  truthy(b > a * 3, `expected superlinear growth, got ${a} -> ${b}`);
});

it('refuses to price a model it does not know, rather than assuming zero', () => {
  eq(priceFor('some-new-model'), null);
  eq(worstCaseRunUsd('some-new-model'), null);
  eq(estimateEval({ model: 'some-new-model', runs: 3 }).priced, false);
});

it('derives a turn cap that fits the money', () => {
  const perRun = 5 / 6;                       // $5 ceiling, 3 runs x 2 arms
  const t = turnsWithinBudget('claude-sonnet-5', perRun);
  truthy(t >= 3, 'should fit at least the floor');
  truthy(worstCaseRunUsd('claude-sonnet-5', { maxTurns: t }) <= perRun, 'derived cap must fit');
  truthy(worstCaseRunUsd('claude-sonnet-5', { maxTurns: t + 1 }) > perRun, 'should be the LARGEST that fits');
});

it('returns null when even a floor-length run cannot fit', () => {
  // The refusal path. Better to say the ceiling is too small than to run one
  // turn and call the result a benchmark.
  eq(turnsWithinBudget('claude-opus-5', 0.01), null);
  eq(turnsWithinBudget('claude-sonnet-5', 0.001), null);
});

it('a whole eval at the derived cap stays inside the ceiling', () => {
  for (const [model, ceiling, runs] of [
    ['claude-sonnet-5', 5, 3], ['claude-haiku-4-5-20251001', 2, 3], ['claude-sonnet-5', 20, 5],
  ]) {
    const perRun = ceiling / (runs * 2);
    const t = turnsWithinBudget(model, perRun);
    truthy(t !== null, `${model} should fit ${ceiling}`);
    const total = worstCaseRunUsd(model, { maxTurns: t }) * runs * 2;
    truthy(total <= ceiling, `${model}: worst ${total} exceeds ceiling ${ceiling}`);
  }
});

it('the estimate leads with the worst case, not the typical', () => {
  const e = estimateEval({ model: 'claude-sonnet-5', runs: 3 });
  truthy(e.worst_case_usd > e.typical_usd, 'worst must exceed typical');
  eq(e.total_runs, 6, 'two arms');
});

/* ── agent adapters: their harness, their key ─────────────────────────── */

it('defaults to driving the harness the adopter already runs', () => {
  const r = resolveAdapter();
  truthy(r.ok);
  eq(r.adapter.id, 'claude-code');
});

it('refuses an unknown adapter and names the escape hatch', () => {
  const r = resolveAdapter('some-harness');
  eq(r.ok, false);
  truthy(r.why.includes('--agent exec'), 'should point at the generic adapter');
});

it('exec needs a command, because there is nothing to guess', () => {
  eq(resolveAdapter('exec').ok, false);
  eq(resolveAdapter('exec', { execCommand: 'my-agent run' }).ok, true);
});

it('declares what it CANNOT measure instead of estimating it', () => {
  // The honest bit. A command doorman knows nothing about cannot be asked how
  // many turns it took, so those columns are declared missing up front.
  const missing = unmeasured(ADAPTERS.exec);
  truthy(missing.includes('turns'), 'exec cannot count turns');
  truthy(missing.includes('cost'), 'exec cannot know cost');
  eq(unmeasured(ADAPTERS['claude-code']), [], 'claude-code reports its own usage');
});

it('checks the adopter has a credential BEFORE building an image', () => {
  const a = ADAPTERS['claude-code'];
  eq(credentialCheck(a, {}).ok, false);
  eq(credentialCheck(a, { ANTHROPIC_API_KEY: 'x' }).ok, true);
  eq(credentialCheck(a, { CLAUDE_CODE_OAUTH_TOKEN: 'x' }).ok, true, 'either credential should do');
});

it('never asks for a credential it does not need', () => {
  eq(credentialCheck(ADAPTERS.exec, {}).ok, true);
});

it('passes the credential through, and stores nothing', () => {
  // The property that makes "your key, your machine" true rather than a claim:
  // the adapter names env vars to forward and holds no value itself.
  for (const a of Object.values(ADAPTERS)) {
    truthy(Array.isArray(a.passEnv), `${a.id} must declare passEnv`);
    eq(JSON.stringify(a).includes('sk-'), false, `${a.id} must embed no credential`);
  }
});

/* ── doctor: reads the build, changes nothing ─────────────────────────── */

it('reports a directory that has no harness without inventing one', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-'));
  const d = await doctor(dir);
  truthy(d.ok);
  eq(d.harnesses, []);
  eq(d.servers, []);
  eq(d.gate.verdict, 'not installed');
  truthy(renderDoctor(d).includes('None detected'));
});

it('distinguishes a gate that is installed from one that is RUNNING', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-'));
  await fs.mkdir(path.join(dir, '.claude', 'hooks'), { recursive: true });
  await fs.writeFile(path.join(dir, '.claude', 'hooks', 'mcp-gate.sh'), 'exit 2');
  await fs.writeFile(path.join(dir, '.claude', 'settings.json'), '{}');
  const d = await doctor(dir);
  // Present but unwired is the dangerous state: it looks exactly like a working
  // gate, and both are quiet.
  truthy(d.gate.installed, 'hook is present');
  eq(d.gate.wired, false);
  truthy(d.gate.verdict.includes('NOT RUNNING'), `got: ${d.gate.verdict}`);
});

it('finds MCP servers and says where each was declared', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-'));
  await fs.writeFile(path.join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { a: { type: 'http', url: 'https://x.example/mcp' } } }));
  const d = await doctor(dir);
  eq(d.servers.length, 1);
  eq(d.servers[0].name, 'a');
  eq(d.servers[0].source, '.mcp.json');
});

it('reports an unreadable config rather than skipping it', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-'));
  await fs.writeFile(path.join(dir, '.mcp.json'), '{ this is not json');
  const d = await doctor(dir);
  eq(d.servers.length, 1);
  truthy(d.servers[0].note.includes('not valid JSON'), 'must surface it, not swallow it');
});

/* ── report ──────────────────────────────────────────────────────────── */

await Promise.all(pending);

for (const [status, name] of results) {
  if (status === 'FAIL') console.log(`  ${status}  ${name}`);
}
console.log(`\n  ${pass} passed, ${fail} failed  (doorman cli)`);
process.exitCode = fail ? 1 : 0;
