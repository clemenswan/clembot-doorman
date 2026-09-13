/**
 * The plugin manifest promises paths. This checks they exist.
 *
 * `claude plugin validate` checks the manifest is well FORMED. It does not
 * check that `./.claude/commands/vet.md` is still there after somebody renames
 * it, and a plugin that installs with a missing component fails the way this
 * project hates most: quietly, with the gate simply not present.
 *
 * The second half matters more than the first. THE REGISTRY MUST NOT BE A
 * DECLARED PLUGIN COMPONENT. A plugin update replaces the plugin directory
 * wholesale, so anything the manifest hands to the harness as ours is
 * something an update can overwrite. The user's trust list is not ours to
 * overwrite, which is invariant 24, and the gate's resolution order is what
 * makes that structural rather than merely intended.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, describe } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const market = JSON.parse(readFileSync(join(ROOT, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
const gate = readFileSync(join(ROOT, '.claude', 'hooks', 'mcp-gate.sh'), 'utf8');
const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));

describe('plugin manifest: components load by AUTO-DISCOVERY, never by declaration');

/**
 * THE TRAP THIS GUARDS, measured against the harness on 2026-09-11.
 *
 *   "agents": ["./agents/doorman.md"]   validates, and loads NOTHING
 *   "agents": ["agents/doorman.md"]     fails validation: agents.0 Invalid input
 *   no `agents` key at all              loads the agent
 *
 * The manifest schema says, of both `agents` and `commands`: "When set, the
 * <dir>/ directory is not auto-loaded". Declaring them therefore turns OFF the
 * scan that works and turns ON a path resolution that silently found nothing,
 * so a plugin that passed `claude plugin validate` shipped a hook and no agent,
 * no /vet and no /doorman.
 *
 * `claude plugin validate` cannot catch this: the manifest is well formed. Only
 * installing it and reading the component inventory shows it, which is what
 * scripts/prepublish.mjs now does.
 *
 * So the rule is: put the files where the harness looks, and say nothing about
 * them in the manifest. These assertions fail if anyone adds the keys back.
 */
for (const key of ['agents', 'commands', 'skills']) {
  check(`the manifest does NOT declare \`${key}\`, which would disable its auto-scan`,
    manifest[key] === undefined,
    `declaring ${key} stops ${key}/ being scanned, and the declared form loaded nothing`);
}

for (const [dir, what] of [['agents', 'the doorman subagent'], ['commands', '/doorman and /vet'], ['skills', 'the guidance skill']]) {
  const at = join(ROOT, dir);
  check(`${dir}/ exists at the plugin root, which is where ${what} is found`,
    existsSync(at) && readdirSync(at).length > 0,
    `${at} is where the harness scans; a file anywhere else is invisible`);
}

// One name per component. The skill and the command were both `doorman`, which
// put two different things under one identity in the inventory.
{
  const names = [
    ...readdirSync(join(ROOT, 'commands')).map((f) => f.replace(/\.md$/, '')),
    ...readdirSync(join(ROOT, 'skills')),
  ];
  check('no two components share a name',
    new Set(names).size === names.length, names.join(', '));
}

describe('plugin manifest: every path it names exists');

const declared = [
  ...(manifest.commands ?? []),
  ...(manifest.agents ?? []),
  ...(typeof manifest.hooks === 'string' ? [manifest.hooks] : []),
  ...(typeof manifest.mcpServers === 'string' ? [manifest.mcpServers] : []),
];

// Only the two that WORK as declarations. agents/commands/skills load by scan.
check('the manifest declares the hook and the MCP server, which do load by path',
  declared.length >= 2, JSON.stringify(declared));

for (const rel of declared) {
  check(`exists: ${rel}`, existsSync(join(ROOT, rel)));
}

describe('plugin manifest: the hook points at the ONE gate, not a copy');

const cmd = hooks.hooks.PreToolUse[0].hooks[0].command;
check('the hook command is rooted at the plugin, not the project',
  cmd.includes('${CLAUDE_PLUGIN_ROOT}'), cmd);
check('and it points at the same mcp-gate.sh install.sh copies',
  cmd.endsWith('/.claude/hooks/mcp-gate.sh'), cmd);
check('the matcher is every MCP tool, so nothing routes around it',
  hooks.hooks.PreToolUse[0].matcher === 'mcp__.*');
check('the plugin hook and the standalone settings.json agree on the matcher',
  JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'))
    .hooks.PreToolUse[0].matcher === hooks.hooks.PreToolUse[0].matcher);

describe('plugin manifest: the registry is NOT a plugin component');

// This is the assertion that protects the user's trust list. If the registry
// ever becomes a declared component, an update overwrites it.
const asText = JSON.stringify(manifest);
check('no declared component path mentions the registry',
  !/registry/i.test(asText),
  'a plugin update replaces declared components, and the trust list is the user’s');
check('the gate prefers the PROJECT registry over the one beside itself',
  gate.includes('CLAUDE_PROJECT_DIR/registry/allowlist.json'),
  'without this the shipped list wins and an update clobbers the user list');
check('the explicit override is still read first, which every test depends on',
  gate.indexOf('DOORMAN_REGISTRY_DIR') < gate.indexOf('CLAUDE_PROJECT_DIR/registry'));

describe('plugin manifest: the marketplace entry agrees with the plugin');

check('the marketplace points at the plugin directory',
  market.plugins[0].source === './doorman', market.plugins[0].source);
check('the names match, or `claude plugin tag` refuses the release',
  market.plugins[0].name === manifest.name,
  `${market.plugins[0].name} vs ${manifest.name}`);
check('the plugin carries a version, since an update is how the gate improves',
  typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version),
  manifest.version);
check('the license is stated, because the repo shipped once without one',
  manifest.license === 'MIT', manifest.license);

describe('plugin: the commands do not assume a global CLI install');

/**
 * Installing the plugin does not put `doorman` on PATH, and the plugin's own
 * commands shell out to it, so a plugin-only user hit `command not found` from
 * the first thing they tried. The dependency turned out to be unnecessary: the
 * installed plugin directory carries `cli/doorman.mjs`, because the plugin IS
 * the repo. scripts/resolve-cli.sh picks PATH first, then that copy.
 */
{
  const resolver = join(ROOT, 'scripts', 'resolve-cli.sh');
  check('the resolver ships with the plugin', existsSync(resolver));

  const body = readFileSync(resolver, 'utf8');
  // Anchor on CODE, not on the header comment: the comment names
  // installed_plugins.json first, so a naive indexOf compares prose.
  const code = body.slice(body.indexOf('set -uo pipefail'));
  // BOTH must be PRESENT and ordered. indexOf returns -1 when absent, and
  // -1 < anything is true, so a bare ordering check PASSES when the PATH
  // lookup is deleted entirely. Watched that mutant survive before fixing it.
  const atPath = code.indexOf('command -v doorman');
  const atCache = code.indexOf('installed_plugins.json');
  check('it consults PATH at all', atPath >= 0, 'the global lookup is gone');
  check('it consults the plugin cache at all', atCache >= 0, 'the fallback is gone');
  check('and PATH is consulted FIRST, because the user chose that install',
    atPath >= 0 && atCache >= 0 && atPath < atCache, `path=${atPath} cache=${atCache}`);
  check('it falls back to the plugin\u2019s own cli/doorman.mjs',
    body.includes('cli') && body.includes('doorman.mjs'));
  check('it says NOT_FOUND rather than printing an unusable empty string',
    body.includes('NOT_FOUND'));

  const cmd = readFileSync(join(ROOT, 'commands', 'doorman.md'), 'utf8');
  check('/doorman resolves the CLI before using it',
    cmd.includes('resolve-cli.sh'));
  // The actual regression: a bare `doorman <subcommand>` in a fenced block.
  const bare = [...cmd.matchAll(/^doorman\s+(doctor|needs|report|allow|watch|eval)\b/gm)];
  check('no command block calls a bare `doorman`, which may not exist',
    bare.length === 0, bare.map((m) => m[0]).join(', '));
}

/**
 * The mode bug, made structural.
 *
 * npm pack on Windows drops the executable bit from every file it packs. The
 * published 0.1.0 tarball was downloaded on 2026-09-12 and mcp-gate.sh in it
 * is `-rw-r--r--`, so on any POSIX machine the gate could not be invoked by
 * path at all. That does not produce a refusal. A hook that cannot spawn never
 * runs, never exits 2, and the tool call proceeds: the security control FAILS
 * OPEN, which its own header says must never happen.
 *
 * Checking the file mode here would prove nothing, because the mode is right
 * in git and wrong only after packing, and a test cannot see the tarball. So
 * the invariant is moved somewhere a test CAN see: the command must not depend
 * on the bit at all.
 */
{
  describe('hook commands do not depend on the executable bit');

  const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const commands = [];
  for (const entries of Object.values(hooks.hooks)) {
    for (const entry of entries) for (const h of entry.hooks) commands.push(h.command);
  }

  check('both hooks are wired', commands.length === 2, `found ${commands.length}`);
  for (const cmd of commands) {
    check(`runs through an interpreter: ${cmd.split('/').pop()}`,
      /^(bash|sh) /.test(cmd),
      `"${cmd}" is invoked by path, so a 644 file silently fails to spawn`);
  }

  // The other half of the same bug: copyFileSync preserves the source mode,
  // and the source inside an installed package is 644.
  const installer = readFileSync(join(ROOT, 'cli', 'install.mjs'), 'utf8');
  check('the installer re-marks the copied gate executable',
    installer.includes('chmodSync') && installer.includes('0o755'),
    'copyFileSync inherits 644 from the package and the gate lands unrunnable');
}
