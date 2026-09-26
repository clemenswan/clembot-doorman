/**
 * Publish dry-run: build the snapshot that WOULD go public, then test it.
 *
 *   node prepublish.mjs [--keep]
 *
 * The public repo is a snapshot of tracked files under clembot-doorman/, not a
 * remote of this branch. So the only honest way to know what a publish ships is
 * to materialise that snapshot somewhere clean and run against it.
 *
 * Testing the working tree instead would test untracked scratch files, another
 * session's in-flight edits, and local chmod that git does not carry. Every one
 * of those has produced a "worked locally, broken published" in this vault.
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Repo root, derived. The snapshot must come from git, never from cwd.
const VAULT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const HELD_BACK = ['clembot-doorman-project.md'];

let pass = 0; let fail = 0; let skipped = 0; const notes = [];
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
// A check that could not run is not a check that passed. Invariant 37: a skip that
// lands in the pass column is how blindness reads as an A.
const skip = (name, why) => { skipped++; console.log(`  SKIP  ${name}\n        ${why}`); };
const sh = (cmd, opts = {}) => {
  try {
    return { out: execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 };
  }
};

// ── 1. Materialise the snapshot from HEAD ───────────────────────────────────
const stage = mkdtempSync(join(tmpdir(), 'doorman-publish-'));
console.log(`\nsnapshot -> ${stage}\n`);
console.log('-- what would ship --');

execSync(`git archive HEAD clembot-doorman | tar -x -C "${stage}"`, { cwd: VAULT });
const ROOT = join(stage, 'clembot-doorman');
ok(existsSync(ROOT), 'the snapshot materialised from HEAD (tracked files only)');

const head = sh('git rev-parse --short HEAD', { cwd: VAULT }).out.trim();
console.log(`        HEAD ${head}`);

for (const f of HELD_BACK) {
  const there = existsSync(join(ROOT, f));
  if (there) rmSync(join(ROOT, f));
  ok(!existsSync(join(ROOT, f)),
    `held back: ${f}${there ? ' (removed from the snapshot)' : ' (already absent)'}`,
    `${f} is still in the snapshot after removal was attempted`);
}

const all = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else all.push(p);
  }
})(ROOT);
console.log(`        ${all.length} files`);

// ── 2. Nothing that must never be published ─────────────────────────────────
console.log('\n-- nothing secret, nothing enormous --');
// Length is part of the shape, on purpose. A real key is long (`sk-ant-api03-` plus
// ~95 chars, `AIzaSy` plus 33); the prefix alone also matched three of this project's
// own fixtures, two of which exist to PROVE a token is never echoed. The PEM branch
// requires a base64 body line for the same reason: a bare header is a test string, a
// header followed by body is a key. Do not shorten these bounds to "catch more" —
// what it caught was our own tests, and a gate that cries wolf gets run with --keep
// and ignored, which is strictly worse than a narrower one that is trusted.
const SECRET = /sk-ant-[A-Za-z0-9_-]{24,}|AIzaSy[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----\s*\r?\n[A-Za-z0-9+/]{40}/;
const leaks = [];
const big = [];
for (const p of all) {
  const rel = p.slice(ROOT.length + 1);
  if (/\.env($|\.)|\.pem$|\.key$/.test(rel)) leaks.push(`${rel} (name)`);
  const size = statSync(p).size;
  if (size > 512 * 1024) big.push(`${rel} ${(size / 1024).toFixed(0)}KB`);
  if (size > 2 * 1024 * 1024) continue;
  let body; try { body = readFileSync(p, 'utf8'); } catch { continue; }
  if (SECRET.test(body)) leaks.push(`${rel} (content)`);
}
ok(leaks.length === 0, 'no credential-shaped content and no key files', leaks.join(', '));
ok(true, `largest files: ${big.length ? big.join(', ') : 'none over 512KB'}`);

// ── 3. Modes, which git carries and local chmod does not ────────────────────
console.log('\n-- the executable bit, which broke this twice --');
const modes = sh('git ls-files -s clembot-doorman | grep "\\.sh$"', { cwd: VAULT }).out.trim().split('\n').filter(Boolean);
const nonExec = modes.filter((l) => !l.startsWith('100755'));
ok(modes.length > 0 && nonExec.length === 0,
  `all ${modes.length} .sh files are 100755 in the index`,
  nonExec.join('\n        '));

// ── 3b. The published repo, the only place the held-back list actually matters ───
// Sanitising the temp snapshot above proves nothing about what is live, because the
// publish step is a manual copy. Found 2026-09-25: clembot-doorman-project.md was
// public and byte-identical to local, while this script reported held-back PASS on
// every run since the repo went public. The check that strips a file cannot also be
// the check that verifies it is gone.
console.log('\n-- the published repo, which the snapshot check cannot see --');
const PUBLIC_REPO = 'clemenswan/clembot-doorman';
// The repo has to resolve before a 404 on a FILE means anything. `gh api` answers 404
// for a missing repo exactly as it does for a missing path, so a renamed repo or a typo
// here would otherwise report every held-back file as safely absent. Caught by
// mutation-checking this section rather than by reading it.
const repoOk = sh(`gh api repos/${PUBLIC_REPO} --jq .full_name`);
if (repoOk.code !== 0 || repoOk.out.trim() !== PUBLIC_REPO) {
  skip(`the published repo ${PUBLIC_REPO}`,
    `did not resolve, so nothing below could be checked: ${repoOk.out.trim().split('\n')[0] || 'no output'}`);
} else for (const f of HELD_BACK) {
  const r = sh(`gh api repos/${PUBLIC_REPO}/contents/${encodeURIComponent(f)} --jq .name`);
  const absent = /HTTP 404|Not Found/i.test(r.out);
  if (r.code === 0) {
    ok(false, `held back on ${PUBLIC_REPO}: ${f} is not published`,
      `${f} IS LIVE at github.com/${PUBLIC_REPO} — delete it there, this snapshot cannot`);
  } else if (absent) {
    ok(true, `held back on ${PUBLIC_REPO}: ${f} is not published`);
  } else {
    // Any other failure (no gh, no auth, no network) means the question was not
    // answered. Reporting that as absent is the false pass this section exists for.
    skip(`held back on ${PUBLIC_REPO}: ${f}`, `could not read the published repo: ${r.out.trim().split('\n')[0] || 'no output'}`);
  }
}

// ── 4. The plugin, as it would be consumed ──────────────────────────────────
console.log('\n-- the plugin a user would install --');
const pluginDir = join(ROOT, 'doorman');
ok(existsSync(join(ROOT, '.claude-plugin', 'marketplace.json')), 'marketplace.json is in the snapshot');
ok(existsSync(join(pluginDir, '.claude-plugin', 'plugin.json')), 'plugin.json is in the snapshot');

const v1 = sh(`claude plugin validate "${pluginDir}"`);
ok(/Validation passed/.test(v1.out), 'plugin manifest validates', v1.out.trim().split('\n').slice(-3).join(' '));
const v2 = sh(`claude plugin validate "${ROOT}"`);
ok(/Validation passed/.test(v2.out), 'marketplace manifest validates', v2.out.trim().split('\n').slice(-3).join(' '));

// Every path the manifest promises must exist IN THE SNAPSHOT, not in the tree.
const man = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
const declared = [
  ...(man.commands ?? []), ...(man.agents ?? []), ...(man.skills ?? []),
  ...(typeof man.hooks === 'string' ? [man.hooks] : []),
  ...(typeof man.mcpServers === 'string' ? [man.mcpServers] : []),
];
const missing = declared.filter((r) => !existsSync(join(pluginDir, r)));
ok(missing.length === 0, `all ${declared.length} declared component paths exist in the snapshot`, missing.join(', '));

// Auto-discovery locations, which is how skills actually registered.
for (const dir of ['commands', 'agents', 'skills']) {
  const at = join(pluginDir, dir);
  const n = existsSync(at) ? readdirSync(at).length : 0;
  notes.push(`${dir}/ at plugin root: ${n ? `${n} entr(ies)` : 'ABSENT'}`);
}

// ── 5. Install it for real, from the snapshot ───────────────────────────────
console.log('\n-- installing from the snapshot --');

// REMEMBER WHERE THE MARKETPLACE POINTED, and put it back at the end.
//
// This check has to register the snapshot as a marketplace to install from it,
// and that displaces whatever the developer had registered. The first version
// of this script left them pointed at a temp directory that the OS later
// deletes, so their next `plugin install` would fail with no obvious cause. A
// test that silently reconfigures the machine it runs on is not a test.
const priorSource = (() => {
  const l = sh('claude plugin marketplace list').out;
  const m = l.match(/clembot-doorman[\s\S]{0,120}?Source:\s*Directory \(([^)]+)\)/);
  return m ? m[1].trim() : null;
})();
if (priorSource) console.log(`        was registered at: ${priorSource}`);

sh('claude plugin uninstall clembot-doorman');
sh('claude plugin marketplace remove clembot-doorman');
const add = sh(`claude plugin marketplace add "${ROOT}"`);
ok(/Successfully added/.test(add.out), 'marketplace adds from the snapshot', add.out.trim());
const inst = sh('claude plugin install clembot-doorman');
ok(/Successfully installed/.test(inst.out), 'plugin installs', inst.out.trim());

const det = sh('claude plugin details clembot-doorman').out;
console.log(det.split('\n').filter((l) => /^\s{2}(Skills|Agents|Hooks|MCP|LSP)/.test(l)).join('\n'));
const count = (k) => Number((det.match(new RegExp(`${k} \\((\\d+)\\)`)) || [])[1] ?? -1);
ok(count('Hooks') >= 1, 'the PreToolUse gate registers (the security-critical part)');
ok(count('MCP servers') >= 1, 'the scorecard MCP server registers');
ok(count('Skills') >= 1, 'the doorman skill registers', 'skills auto-discover from skills/ at the PLUGIN ROOT, not .claude/skills/');
// The one that shipped broken. Declaring `agents` in the manifest VALIDATES and
// loads nothing, because declaring it turns off the directory scan that works.
// Only an install shows it, which is the whole reason this file exists.
ok(count('Agents') >= 1, 'the doorman subagent registers',
  'a declared `agents` key disables the agents/ scan and loads nothing. Remove it.');

// ── 6. The suites, run inside the snapshot ──────────────────────────────────
console.log('\n-- the suites, against the snapshot copy --');
for (const [name, cmd] of [
  ['unit', 'node test/run.mjs'],
  ['gate', 'bash test-gate.sh'],
  ['install', 'bash test-install.sh'],
  ['poller', 'node test-poller.mjs'],
]) {
  const r = sh(cmd, { cwd: pluginDir });
  const last = r.out.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
  ok(r.code === 0, `${name}: ${last.trim()}`, r.code === 0 ? '' : r.out.trim().split('\n').slice(-6).join('\n        '));
}

// ── 7. The giveaway path, into a clean project ──────────────────────────────
console.log('\n-- install.sh into a clean project --');
const target = mkdtempSync(join(tmpdir(), 'doorman-target-'));
const ins = sh(`bash install.sh "${target}"`, { cwd: pluginDir });
ok(ins.code === 0, 'install.sh exits 0', ins.out.trim().split('\n').slice(-6).join('\n        '));
ok(/4\/4/.test(ins.out), 'its self-check reports 4 of 4 against the INSTALLED gate');
ok(existsSync(join(target, '.claude', 'hooks', 'mcp-gate.sh')), 'the gate landed');
ok(existsSync(join(target, 'registry', 'allowlist.json')), 'the registry landed where the gate looks');

// ── 8. The generated site panel must match its evidence ─────────────────────
console.log('\n-- the site panel has not drifted from its captures --');
const idx = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8');
const cap = existsSync(join(ROOT, 'evidence', 'needs-demo', 'fullstack.txt'))
  ? readFileSync(join(ROOT, 'evidence', 'needs-demo', 'fullstack.txt'), 'utf8') : '';
const marker = idx.includes('<sim-presets> generated by scripts/build-sim.mjs');
ok(marker, 'the panel is marked generated, not hand-written');
// Pick a line the COLOURISER does not split. `UNMET ...` gets a <span> wrapped
// round the verdict word, so the raw line never appears contiguously in the
// HTML and searching for it fails against a perfectly good page. Same mistake
// shape as the contrast probe: the instrument was wrong, not the artifact.
const probes = [
  'nothing graded covers this. The feed has the gap, not your build.',
  (cap.match(/^\s+> .*$/m) || [''])[0].trim().replace(/^&gt;|^>/, '').trim(),
].filter(Boolean);
const found = probes.filter((p) => p.length > 20 && idx.includes(p));
ok(found.length > 0,
  `verbatim capture text appears in the shipped page (${found.length}/${probes.length} probes)`,
  `none of: ${probes.map((p) => p.slice(0, 45)).join(' | ')}`);
ok(!/12,400|2,100 tokens|64% first-try|98% first-try/.test(idx),
  'the fabricated A/B numbers are gone from the shipped page');

// ── restore the machine to how it was found ─────────────────────────────────
console.log('\n-- putting the marketplace back --');
sh('claude plugin uninstall clembot-doorman');
sh('claude plugin marketplace remove clembot-doorman');
if (priorSource && existsSync(priorSource)) {
  const back = sh(`claude plugin marketplace add "${priorSource}"`);
  ok(/Successfully added/.test(back.out), `restored to ${priorSource}`, back.out.trim());
  sh('claude plugin install clembot-doorman');
} else {
  ok(true, priorSource
    ? `previous source no longer exists (${priorSource}); left unregistered rather than pointing at a temp dir`
    : 'nothing was registered before this run; left unregistered');
}

// ── report ──────────────────────────────────────────────────────────────────
console.log('\n-- notes --');
for (const n of notes) console.log(`  ${n}`);
console.log(`\n  ${pass} passed, ${fail} failed${skipped ? `, ${skipped} NOT CHECKED` : ''}`);
if (!process.argv.includes('--keep')) {
  console.log(`\n  snapshot kept at: ${stage}`);
}
// 3 for "gaps found", per .claude/rules/agent-cli-conventions.md #6. A skipped check
// must not exit 0: green then means verified, and it did not verify.
process.exitCode = fail ? 1 : skipped ? 3 : 0;
