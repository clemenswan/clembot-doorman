/**
 * Tests for `doorman install` Node implementation.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import { install, renderInstall, GATE_HOOK_CONFIG } from '../cli/install.mjs';

describe('install: dry run');
{
  const res = await install(process.cwd(), { dryRun: true });
  check('dry run succeeds', res.ok === true);
  check('dry run does not write files', res.dryRun === true);
  check('identifies files to copy', res.copied.length >= 4);
  const text = renderInstall(res);
  check('renders output with dry run note', text.includes('dry run: nothing was written'));
}

describe('install: real install into temporary directory');
{
  const temp = mkdtempSync(join(tmpdir(), 'doorman-install-test-'));
  try {
    const res = await install(temp);
    check('install into temp dir succeeds', res.ok === true);
    check('copies mcp-gate.sh', existsSync(join(temp, '.claude', 'hooks', 'mcp-gate.sh')));
    check('copies doorman.md agent', existsSync(join(temp, '.claude', 'agents', 'doorman.md')));
    check('copies vet.md command', existsSync(join(temp, '.claude', 'commands', 'vet.md')));
    check('copies the doorman-guide SKILL.md', existsSync(join(temp, '.claude', 'skills', 'doorman-guide', 'SKILL.md')));
    check('copies allowlist.json', existsSync(join(temp, 'registry', 'allowlist.json')));
    check('copies denylist.json', existsSync(join(temp, 'registry', 'denylist.json')));
    check('creates ledger.jsonl', existsSync(join(temp, 'registry', 'ledger.jsonl')));
    check('creates and wires settings.json', existsSync(join(temp, '.claude', 'settings.json')));

    const settings = JSON.parse(readFileSync(join(temp, '.claude', 'settings.json'), 'utf8'));
    check('settings.json contains PreToolUse hook', Array.isArray(settings.hooks?.PreToolUse));
    check('PreToolUse hook references mcp-gate.sh', settings.hooks.PreToolUse[0].hooks[0].command.includes('mcp-gate.sh'));

    // Second install should keep existing registry
    const res2 = await install(temp);
    check('second install succeeds', res2.ok === true);
    check('second install keeps existing registry', res2.registryStatus === 'kept');
  } finally {
    try { rmSync(temp, { recursive: true, force: true }); } catch {}
  }
}
