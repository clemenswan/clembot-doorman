/**
 * `doorman install [target]` — install the gate, subagent, slash command,
 * and skill into a target project.
 *
 * Cross-platform Node implementation of install.sh. Zero runtime dependencies.
 *
 * It copies:
 *   - .claude/hooks/mcp-gate.sh
 *   - agents/doorman.md
 *   - commands/vet.md
 *   - skills/doorman-guide/SKILL.md
 *   - registry/allowlist.json & denylist.json (NEVER overwrites an existing registry)
 *
 * And safely inspects/wires .claude/settings.json without destructive clobbering.
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const GATE_HOOK_CONFIG = {
  matcher: 'mcp__.*',
  hooks: [{
    type: 'command',
    command: '$CLAUDE_PROJECT_DIR/.claude/hooks/mcp-gate.sh',
    timeout: 5,
  }],
};

export async function install(targetDir = process.cwd(), { dryRun = false } = {}) {
  const absTarget = resolve(targetDir);
  if (!existsSync(absTarget)) {
    return { ok: false, why: `target directory does not exist: ${absTarget}` };
  }

  const copied = [];
  const kept = [];
  const warnings = [];

  const copy = (srcRel, destRel) => {
    const src = join(ROOT, srcRel);
    const dest = join(absTarget, destRel);
    if (!existsSync(src)) {
      warnings.push(`source file not found: ${srcRel}`);
      return;
    }
    if (dryRun) {
      copied.push(`${srcRel} -> ${destRel}`);
      return;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    copied.push(destRel);
  };

  // 1. Hooks, Subagent, Command
  copy('.claude/hooks/mcp-gate.sh', '.claude/hooks/mcp-gate.sh');
  copy('agents/doorman.md', '.claude/agents/doorman.md');
  copy('commands/vet.md', '.claude/commands/vet.md');

  // 2. Doorman Skill (both in .claude/skills and .agents/skills if applicable)
  copy('skills/doorman-guide/SKILL.md', '.claude/skills/doorman-guide/SKILL.md');
  if (existsSync(join(absTarget, '.agents'))) {
    copy('skills/doorman-guide/SKILL.md', '.agents/skills/doorman-guide/SKILL.md');
  }

  // 3. Registry (never overwrite existing)
  let registryStatus = 'copied';
  const targetAllowlist = join(absTarget, 'registry', 'allowlist.json');
  if (existsSync(targetAllowlist)) {
    registryStatus = 'kept';
    kept.push('registry/allowlist.json (existing trust list preserved)');
  } else if (!dryRun) {
    mkdirSync(join(absTarget, 'registry'), { recursive: true });
    copyFileSync(join(ROOT, 'registry', 'allowlist.json'), targetAllowlist);
    copyFileSync(join(ROOT, 'registry', 'denylist.json'), join(absTarget, 'registry', 'denylist.json'));
    writeFileSync(join(absTarget, 'registry', 'ledger.jsonl'), '', 'utf8');
    copied.push('registry/ (allowlist.json, denylist.json, ledger.jsonl)');
  } else {
    copied.push('registry/ (allowlist.json, denylist.json, ledger.jsonl)');
  }

  // 4. Inspect & wire settings.json
  const settingsPath = join(absTarget, '.claude', 'settings.json');
  let settingsWired = false;
  let settingsStatus = 'missing';

  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf8');
      if (raw.includes('mcp-gate.sh')) {
        settingsWired = true;
        settingsStatus = 'already-wired';
      } else {
        const settings = JSON.parse(raw);
        if (!settings.hooks) settings.hooks = {};
        if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];
        settings.hooks.PreToolUse.push(GATE_HOOK_CONFIG);
        if (!dryRun) {
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
        }
        settingsWired = true;
        settingsStatus = 'wired';
      }
    } catch {
      settingsStatus = 'unparseable';
      warnings.push('.claude/settings.json exists but is not valid JSON. Wire hook manually.');
    }
  } else if (!dryRun) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    const initialSettings = {
      hooks: {
        PreToolUse: [GATE_HOOK_CONFIG],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(initialSettings, null, 2) + '\n', 'utf8');
    settingsWired = true;
    settingsStatus = 'created-and-wired';
  }

  return {
    ok: true,
    target: absTarget,
    dryRun,
    copied,
    kept,
    warnings,
    registryStatus,
    settingsWired,
    settingsStatus,
  };
}

export function renderInstall(res) {
  const L = [];
  L.push('');
  L.push(`doorman install -> ${res.target}`);
  if (res.dryRun) L.push('  (dry run: nothing was written)');
  L.push('');

  L.push('## Files installed');
  for (const c of res.copied) L.push(`  + ${c}`);
  for (const k of res.kept) L.push(`  = ${k}`);
  L.push('');

  L.push('## Gate & Hook Wiring');
  if (res.settingsWired) {
    L.push(`  [PASS] Hook is wired in .claude/settings.json (${res.settingsStatus})`);
  } else {
    L.push(`  [WARN] Hook is NOT wired in .claude/settings.json (${res.settingsStatus})`);
    L.push('         Add the PreToolUse hook manually to activate protection.');
  }
  L.push('');

  L.push('## Registry Trust List');
  if (res.registryStatus === 'kept') {
    L.push('  Your existing trust list was preserved. What is trusted has not changed.');
  } else {
    L.push('  Initial registry deployed with baseline trust list.');
    L.push('  Everything else your agent reaches for is blocked until vetted: /vet <url>');
  }
  L.push('');

  if (res.warnings.length) {
    L.push('## Warnings');
    for (const w of res.warnings) L.push(`  ! ${w}`);
    L.push('');
  }

  L.push('Done. Run `doorman doctor` to verify your installation.');
  return L.join('\n');
}
