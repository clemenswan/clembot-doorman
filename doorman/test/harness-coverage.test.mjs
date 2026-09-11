/**
 * Reading a build that is not Claude Code.
 *
 * THE BUG THIS EXISTS FOR. `findInventoryRoot` looked only for `.claude/agents`,
 * so a Cursor project had no root at all: the whole reader was skipped and the
 * caller got an empty inventory indistinguishable from a project with nothing
 * installed. `doorman watch` then told that user that two servers listed in
 * their own `.cursor/mcp.json` were "new to this build".
 *
 * That is the failure class this project exists to punish, shipped in the
 * project itself: a confident answer to a question the code could not actually
 * see. `doctor` had read five config locations since it shipped; this read one.
 *
 * The fix is two things, and the second matters more than the first. Read the
 * other config locations, AND report what could not be read, so "0 agents" in a
 * Cursor project is never mistaken for a fact about that project.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import {
  MCP_CONFIG_SOURCES, ROOT_MARKERS, findInventoryRoot, gatherInventory,
} from '../src/inventory.mjs';
import { classify, installedKeys, serverKey } from '../cli/watch.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'doorman-harness-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  return root;
}

const CURSOR = project({
  '.cursor/mcp.json': JSON.stringify({
    mcpServers: {
      exa: { url: 'https://mcp.exa.ai/mcp' },
      deepwiki: { url: 'https://mcp.deepwiki.com/mcp' },
    },
  }),
});

const VSCODE = project({
  // VS Code spells the key `servers`, not `mcpServers`.
  '.vscode/mcp.json': JSON.stringify({ servers: { exa: { url: 'https://mcp.exa.ai/mcp' } } }),
});

const CLAUDE = project({
  '.claude/agents/one.md': '---\nname: one\ntools: Read, mcp__exa__search\n---\nbody',
  '.mcp.json': JSON.stringify({ mcpServers: { exa: { url: 'https://mcp.exa.ai/mcp' } } }),
});

describe('harness coverage: a project is not only a Claude Code project');

check('a Cursor project is a root', Boolean(findInventoryRoot(CURSOR)));
check('a VS Code project is a root', Boolean(findInventoryRoot(VSCODE)));
check('a Claude Code project is still a root', Boolean(findInventoryRoot(CLAUDE)));
check('every declared root marker is one this reader knows',
  ROOT_MARKERS.includes('.claude/agents') && ROOT_MARKERS.includes('.cursor/mcp.json'));

describe('harness coverage: servers are read wherever they are declared');

{
  const inv = gatherInventory({ root: CURSOR });
  const names = inv.mcpServers.map((m) => m.name).sort();
  check('reads .cursor/mcp.json', names.join(',') === 'deepwiki,exa', names.join(','));
  check('keeps the url, which is what matching needs',
    inv.mcpServers.every((m) => Boolean(m.url)),
    JSON.stringify(inv.mcpServers));
  check('records WHICH file declared it',
    inv.mcpServers[0].sources.includes('.cursor/mcp.json'),
    JSON.stringify(inv.mcpServers[0].sources));
}

{
  const inv = gatherInventory({ root: VSCODE });
  check('reads the VS Code `servers` spelling as well as `mcpServers`',
    inv.mcpServers.length === 1 && inv.mcpServers[0].name === 'exa',
    JSON.stringify(inv.mcpServers));
}

describe('harness coverage: what could NOT be read is stated');

{
  const cursor = gatherInventory({ root: CURSOR });
  check('a Cursor project reports agents as unknown, not as zero',
    cursor.coverage.agents === 'unknown', JSON.stringify(cursor.coverage));
  check('and says so in a note a human will read',
    cursor.notes.some((n) => /UNKNOWN rather than absent/.test(n)), cursor.notes.join(' | '));
  check('but its MCP config WAS read, so that half is trustworthy',
    cursor.coverage.mcpServers === 'read', JSON.stringify(cursor.coverage));

  const claude = gatherInventory({ root: CLAUDE });
  check('a Claude Code project reports agents as READ, so 0 would be a fact',
    claude.coverage.agents === 'read', JSON.stringify(claude.coverage));
  check('the two projects do NOT report the same coverage',
    claude.coverage.agents !== cursor.coverage.agents,
    'if these ever match, the distinction this file exists for is gone');
}

describe('harness coverage: the bug itself');

{
  const inv = gatherInventory({ root: CURSOR });
  const keys = installedKeys(inv);
  const row = (url) => ({
    server_url: url, grade: 'A', score: 90, hard_fail: null,
    layers: { static_pct: 90, behavioral_pct: null, guidance_pct: null },
    self_graded: false, is_fixture: false,
  });
  check('a server in .cursor/mcp.json is already-installed, not "new to this build"',
    classify(row('https://mcp.exa.ai/mcp'), keys).verdict === 'already-installed',
    'this returned "unreviewed" before the fix, telling a Cursor user to adopt ' +
    'something listed in their own config');
  check('and so is the second one',
    classify(row('https://mcp.deepwiki.com/mcp'), keys).verdict === 'already-installed');
  check('while something genuinely absent is still unreviewed',
    classify(row('https://mcp.notinstalled.test/mcp'), keys).verdict === 'unreviewed');
}

describe('harness coverage: doctor and the inventory read the same list');

{
  // They diverged silently for the life of the project. This is the assertion
  // that would have caught it, and it is cheap.
  const wanted = ['.mcp.json', '.claude/settings.json', '.cursor/mcp.json', '.vscode/mcp.json'];
  const missing = wanted.filter((w) => !MCP_CONFIG_SOURCES.includes(w));
  check('the inventory reads every location doctor probes',
    missing.length === 0, 'missing: ' + missing.join(', '));
  check('serverKey treats the same url from two files as one server',
    serverKey('https://mcp.exa.ai/mcp') === serverKey('https://mcp.exa.ai/mcp/'));
}
