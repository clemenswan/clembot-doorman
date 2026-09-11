/**
 * `doorman doctor` — L0. What is actually in YOUR build.
 *
 * This is the layer that costs nobody anything. No model, no container, no
 * network: it reads the project in front of it and reports what an agent in
 * that project can currently reach.
 *
 * It exists because the question "is this tool worth adopting" has no universal
 * answer. It depends on which harness you run, which model, which servers are
 * already installed, and what your agents actually do. A benchmark run on
 * somebody else's stack answers their question, not yours. So doorman looks at
 * yours first, and every later layer is scoped to what it finds here.
 *
 * Everything below is read-only. It opens config files, never writes one, and
 * never sends what it read anywhere.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const read = async (p) => {
  try { return await readFile(p, 'utf8'); } catch { return null; }
};
const readJson = async (p) => {
  const t = await read(p);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return { __unparseable: true }; }
};

/**
 * Which agent harness is this project set up for.
 *
 * Reported as evidence, not as a guess: each hit names the file that proved it,
 * so a wrong answer can be argued with.
 */
async function detectHarness(root) {
  const found = [];
  const probe = async (rel, name, note) => {
    if (existsSync(path.join(root, rel))) found.push({ harness: name, evidence: rel, note });
  };
  await probe('.claude', 'Claude Code', 'project-scoped agents, commands, hooks');
  await probe('CLAUDE.md', 'Claude Code', 'project instructions');
  await probe('AGENTS.md', 'Codex / AGENTS.md convention', 'project instructions');
  await probe('.cursor', 'Cursor', 'editor-integrated agent');
  await probe('.windsurf', 'Windsurf', 'editor-integrated agent');
  await probe('.github/copilot-instructions.md', 'GitHub Copilot', 'repo instructions');
  await probe('.gemini', 'Gemini CLI', 'project config');

  // Deduplicate by harness, keeping every piece of evidence.
  const byName = new Map();
  for (const f of found) {
    if (!byName.has(f.harness)) byName.set(f.harness, { harness: f.harness, evidence: [], note: f.note });
    byName.get(f.harness).evidence.push(f.evidence);
  }
  return [...byName.values()];
}

/** Every MCP server this project can reach, and where that was declared. */
async function detectMcpServers(root) {
  const servers = [];
  const sources = [
    '.mcp.json',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.cursor/mcp.json',
    '.vscode/mcp.json',
  ];
  for (const rel of sources) {
    const j = await readJson(path.join(root, rel));
    if (!j) continue;
    if (j.__unparseable) {
      servers.push({ name: '(unreadable)', source: rel, transport: null, target: null,
                     note: 'file exists but is not valid JSON' });
      continue;
    }
    const block = j.mcpServers || j.servers || {};
    for (const [name, cfg] of Object.entries(block)) {
      servers.push({
        name,
        source: rel,
        transport: cfg?.type || (cfg?.command ? 'stdio' : cfg?.url ? 'http' : 'unknown'),
        target: cfg?.url || cfg?.command || null,
        args: Array.isArray(cfg?.args) ? cfg.args.length : 0,
      });
    }
  }
  return servers;
}

/** Subagents, and which of them hold MCP tools. That ratio is the exposure. */
async function detectAgents(root) {
  const dir = path.join(root, '.claude', 'agents');
  if (!existsSync(dir)) return { count: 0, withMcp: [], dir: null };
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.md')); } catch { return { count: 0, withMcp: [], dir }; }
  const withMcp = [];
  for (const f of files) {
    const text = (await read(path.join(dir, f))) || '';
    // Frontmatter `tools:` naming an mcp__ tool is the thing worth counting.
    const hits = text.match(/mcp__[a-zA-Z0-9_-]+/g);
    if (hits) withMcp.push({ agent: f.replace(/\.md$/, ''), tools: [...new Set(hits)].length });
  }
  return { count: files.length, withMcp, dir: path.join('.claude', 'agents') };
}

/**
 * Is the doorman gate installed and wired, or installed and inert?
 *
 * THERE ARE TWO WAYS TO INSTALL IT NOW, and this used to see only one. The
 * plugin route puts the gate in the plugin directory and wires it through the
 * plugin's own hooks.json, so a plugin user got told "not installed" by the one
 * command whose entire job is answering that question, while the gate was
 * actively blocking their calls. Reporting a control as absent when it is
 * running is the same failure class as reporting it present when it is not.
 *
 * Project install is still reported first, because it is the one the operator
 * controls per project. The plugin is reported as a second, separate source.
 */
async function detectGate(root, { env = process.env } = {}) {
  const hook = path.join(root, '.claude', 'hooks', 'mcp-gate.sh');
  const installed = existsSync(hook);
  const settings = await read(path.join(root, '.claude', 'settings.json'));
  const wired = Boolean(settings && settings.includes('mcp-gate.sh'));
  const registry = existsSync(path.join(root, 'registry', 'allowlist.json'));

  // A user-scope plugin gates every project, so its absence from THIS project
  // says nothing. Detected by looking for an installed plugin that ships the
  // hook, not by asking the harness, so this stays offline and dependency-free.
  const plugin = detectPluginGate(env);

  const anyGate = installed || plugin.present;
  return {
    installed,
    wired,
    registry,
    plugin,
    // The distinction that matters: a gate that is present and not wired is a
    // gate that is not running, and it looks exactly like one that is.
    verdict: !anyGate ? 'not installed'
      : !installed && plugin.present ? `installed as a PLUGIN (${plugin.name}), wired by the plugin`
      : !wired ? 'INSTALLED BUT NOT RUNNING (no hook entry in settings.json)'
      : !registry && !plugin.present ? 'wired, but no registry/allowlist.json: it will block everything'
      : 'installed and wired',
  };
}

/** An installed Claude Code plugin that ships mcp-gate.sh. Read-only. */
function detectPluginGate(env) {
  const home = env.USERPROFILE || env.HOME;
  if (!home) return { present: false, why: 'no home directory in the environment' };
  const record = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(record)) return { present: false, why: 'no installed_plugins.json' };
  let raw;
  try { raw = JSON.parse(readFileSync(record, 'utf8')); } catch {
    return { present: false, why: 'installed_plugins.json did not parse' };
  }
  // The shape of that file is the harness's business and it has changed before,
  // so match on content rather than on a path into it.
  const text = JSON.stringify(raw);
  const named = /"(clembot-doorman[^"]*)"/.exec(text);
  if (!named) return { present: false, why: 'no clembot-doorman plugin installed' };
  return { present: true, name: named[1], record };
}

/** What an eval could drive. Presence only: nothing is executed. */
async function detectAgentRunners(root) {
  const out = [];
  const pkg = await readJson(path.join(root, 'package.json'));
  if (pkg && !pkg.__unparseable) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const d of Object.keys(deps)) {
      if (/claude|anthropic|openai|langchain|langgraph|crewai|agent/i.test(d)) {
        out.push({ kind: 'dependency', name: d, version: deps[d] });
      }
    }
  }
  return out;
}

export async function doctor(root, opts = {}) {
  const abs = path.resolve(root);
  let ok = true;
  try { ok = (await stat(abs)).isDirectory(); } catch { ok = false; }
  if (!ok) return { ok: false, why: `not a directory: ${abs}` };

  const [harnesses, servers, agents, gate, runners] = await Promise.all([
    detectHarness(abs), detectMcpServers(abs), detectAgents(abs), detectGate(abs, opts), detectAgentRunners(abs),
  ]);
  return { ok: true, root: abs, harnesses, servers, agents, gate, runners };
}

export function renderDoctor(d) {
  const L = [];
  L.push(`# Your build`);
  L.push('');
  L.push(`\`${d.root}\``);
  L.push('');
  L.push('Read-only. Nothing here was executed, sent anywhere, or billed.');
  L.push('');

  L.push('## Harness');
  L.push('');
  if (!d.harnesses.length) {
    L.push('None detected. doorman can still grade a server, but an eval needs an agent');
    L.push('to drive, so `doorman eval --agent` would have to be told what to run.');
  } else {
    for (const h of d.harnesses) L.push(`- **${h.harness}** (${h.evidence.join(', ')})`);
  }
  L.push('');

  L.push('## MCP servers this project can reach');
  L.push('');
  if (!d.servers.length) {
    L.push('None declared. Nothing to grade yet, and nothing to gate.');
  } else {
    L.push('| Server | Transport | Declared in | Target |');
    L.push('|---|---|---|---|');
    for (const s of d.servers) {
      L.push(`| \`${s.name}\` | ${s.transport ?? '?'} | \`${s.source}\` | ${s.target ? '`' + String(s.target).slice(0, 60) + '`' : '-'} |`);
    }
    L.push('');
    L.push(`**${d.servers.length} server(s).** Each one describes its own tools to your`);
    L.push('agent, and your agent reads those descriptions as instructions.');
  }
  L.push('');

  L.push('## Agents');
  L.push('');
  if (!d.agents.count) {
    L.push('No `.claude/agents/` directory.');
  } else {
    L.push(`**${d.agents.count} subagent(s)** in \`${d.agents.dir}\`.`);
    if (d.agents.withMcp.length) {
      L.push('');
      for (const a of d.agents.withMcp) L.push(`- \`${a.agent}\` references ${a.tools} MCP tool name(s)`);
      L.push('');
      L.push('A tool handed to every agent costs every agent: each one carries');
      L.push('descriptions it will mostly never call, plus that many more chances to');
      L.push('pick the wrong one.');
    } else {
      L.push('None of them reference an MCP tool by name.');
    }
  }
  L.push('');

  L.push('## The gate');
  L.push('');
  L.push(`**${d.gate.verdict}**`);
  L.push('');
  L.push(`- hook present: ${d.gate.installed ? 'yes' : 'no'}`);
  L.push(`- wired in settings.json: ${d.gate.wired ? 'yes' : 'no'}`);
  L.push(`- registry present: ${d.gate.registry ? 'yes' : 'no'}`);
  L.push(`- installed as a plugin: ${d.gate.plugin?.present ? `yes (${d.gate.plugin.name})` : 'no'}`);
  if (d.gate.plugin?.present && !d.gate.installed) {
    L.push('');
    L.push('> The gate is running from a user-scope PLUGIN, so it applies to every');
    L.push('> project on this machine, not just this one. The trust list it reads is');
    L.push('> `$CLAUDE_PROJECT_DIR/registry/allowlist.json` if this project has one,');
    L.push('> and the plugin default otherwise. `doorman install .` gives this project');
    L.push('> its own list, which a plugin update can never overwrite.');
  }
  if (d.gate.installed && !d.gate.wired) {
    L.push('');
    L.push('> A gate that is installed and not wired is not running, and looks exactly');
    L.push('> like one that is. Both are quiet.');
  }
  L.push('');

  if (d.runners.length) {
    L.push('## Agent-ish dependencies');
    L.push('');
    for (const r of d.runners) L.push(`- \`${r.name}\` ${r.version}`);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('_`doorman doctor`. Static, local, free. It reports what is here; it does not');
  L.push('say whether any of it works. That is `doorman report` and `doorman eval`._');
  return L.join('\n') + '\n';
}
