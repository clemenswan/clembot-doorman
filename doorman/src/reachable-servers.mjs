/**
 * MCP servers an agent in this project can reach that the project never declared.
 *
 * `doorman doctor` used to read five project files and nothing else. On a real
 * Claude Code install most servers live somewhere else: the user's
 * `~/.claude.json`, plugins installed at user scope, plugins synced from a
 * claude.ai account, and the claude.ai connectors themselves. The vault this
 * was written against had zero project-declared servers and roughly thirty
 * reachable ones, and doctor graded it on the zero.
 *
 * Every entry carries `gateName`, the `<server>` in `mcp__<server>__<tool>`.
 * That is the only identity the gate can see, so it is the only key a trust
 * list can use. Claude Code builds it by replacing anything outside
 * [A-Za-z0-9_-] with `_`, and plugin servers as `plugin_<plugin>_<server>`.
 * Both rules were read off the tool names of a live session, not a doc.
 *
 * Offline and read-only, like the rest of doctor. Nothing is executed and no
 * url is contacted. A claude.ai connector's url and tools are held by the
 * account, not on disk, so its target is `null` rather than a guess.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const toolPrefix = (name) => String(name).replace(/[^A-Za-z0-9_-]/g, '_');

const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
};

// ponytail: case-insensitive path compare. Right for Windows and default macOS,
// wrong on a case-sensitive Linux volume with two projects differing by case.
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const dirs = (dir) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
};

export function userScopeServers(root, { home } = {}) {
  if (!home || !existsSync(home)) return [];
  const out = new Map();

  const add = (block, source, plugin = null) => {
    if (!block || typeof block !== 'object') return;
    for (const [name, cfg] of Object.entries(block)) {
      // An http entry with an empty url is a placeholder Claude Code skips, so
      // an agent never sees its tools. Listing it would grade a ghost.
      if (!cfg?.command && !cfg?.url) continue;
      const gateName = toolPrefix(plugin ? `plugin_${plugin}_${name}` : name);
      const seen = out.get(gateName);
      if (seen) { if (!seen.sources.includes(source)) seen.sources.push(source); continue; }
      out.set(gateName, {
        name, gateName, source, sources: [source],
        transport: cfg.type || (cfg.command ? 'stdio' : 'http'),
        target: cfg.url || cfg.command,
      });
    }
  };

  const claudeJson = readJson(path.join(home, '.claude.json'));
  if (claudeJson) {
    add(claudeJson.mcpServers, '~/.claude.json (user)');
    for (const [p, v] of Object.entries(claudeJson.projects || {})) {
      if (samePath(p, root)) add(v?.mcpServers, '~/.claude.json (local)');
    }
    for (const name of claudeJson.claudeAiMcpEverConnected || []) {
      const gateName = toolPrefix(name);
      out.set(gateName, {
        name, gateName, source: 'claude.ai account', sources: ['claude.ai account'],
        transport: 'claude.ai', target: null,
        note: 'connector on your claude.ai account; its url and tools are not stored locally',
      });
    }
  }

  // An explicit `false` in either settings file turns a plugin off; absent means on.
  const enabled = {
    ...(readJson(path.join(home, '.claude', 'settings.json'))?.enabledPlugins || {}),
    ...(readJson(path.join(root, '.claude', 'settings.json'))?.enabledPlugins || {}),
  };
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  for (const [id, installs] of Object.entries(installed?.plugins || {})) {
    if (enabled[id] === false) continue;
    const plugin = id.split('@')[0];
    for (const e of Array.isArray(installs) ? installs : []) {
      if (!(e.scope === 'user' || (e.projectPath && samePath(e.projectPath, root)))) continue;
      if (!e.installPath) continue;
      const mcp = readJson(path.join(e.installPath, '.mcp.json'));
      add(mcp?.mcpServers ?? mcp, `plugin:${id}`, plugin);
      // ponytail: inline object only. A plugin.json whose mcpServers is a PATH
      // string is skipped; resolve it when a real plugin ships one.
      add(readJson(path.join(e.installPath, '.claude-plugin', 'plugin.json'))?.mcpServers, `plugin:${id}`, plugin);
    }
  }

  const synced = path.join(home, '.claude', 'plugins', 'synced');
  for (const account of dirs(synced)) {
    for (const plugin of dirs(path.join(synced, account))) {
      add(readJson(path.join(synced, account, plugin, '.mcp.json'))?.mcpServers, `plugin:${plugin} (synced)`, plugin);
    }
  }

  return [...out.values()];
}
