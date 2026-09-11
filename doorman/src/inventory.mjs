/**
 * What the fit review is allowed to know about your system.
 *
 * FRONTMATTER ONLY, and that is a hard constraint rather than an optimisation.
 * Measured on this vault: reading agent, skill and command BODIES is 642 KB.
 * Reading their frontmatter is about 30 KB. Only one of those fits in a single
 * model call, so the shape of this module is decided by arithmetic.
 *
 * The consequence is worth stating plainly: a fit review reasons about what
 * your agents and skills SAY THEY DO, not about what they actually do. That is
 * the same class of claim this whole project exists to distrust in MCP servers.
 * It is acceptable here only because the fit verdict is free, reversible, and
 * gates nothing on its own: a human reads it and flips a status by hand.
 *
 * Nothing here makes a network request or writes a file.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** CLAUDE.md is 29 KB in this vault. Cap it and SAY that it was capped. */
export const CLAUDE_MD_CAP = 8000;

/**
 * Find the project whose inventory we should read.
 *
 * This repo is the giveaway. The agents and skills a fit review reasons about
 * live in whatever project someone dropped it into, which is why this walks up
 * rather than resolving anything relative to itself.
 */
/**
 * Every file a project can declare an MCP server in.
 *
 * Kept beside the reader rather than inline so the list is one thing, and
 * exported so `doctor` and this module can be asserted equal. They were not:
 * doctor read five, this read one, and the gap showed up as a Cursor user
 * being told to adopt servers they already ran.
 */
export const MCP_CONFIG_SOURCES = [
  '.mcp.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
];

/**
 * Anything that marks a directory as an agent project.
 *
 * `.claude/agents` used to be the only one, which meant a Cursor project had NO
 * root at all: the whole reader was skipped and the caller received an empty
 * inventory that looked exactly like a project with nothing installed. `watch`
 * then told that user to consider adopting two servers listed in their own
 * `.cursor/mcp.json`.
 */
export const SKILL_SOURCES = [
  '.claude/skills',
  '.agents/skills',
  'skills',
];

export const ROOT_MARKERS = [
  '.claude/agents',
  '.claude/skills',
  '.agents/skills',
  '.claude/settings.json',
  '.mcp.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  'CLAUDE.md',
  'AGENTS.md',
];

export function findInventoryRoot(startDir, { env = process.env, fs = { existsSync } } = {}) {
  const configured = env.DOORMAN_INVENTORY_ROOT;
  if (configured) return resolve(configured);

  let dir = resolve(startDir);
  for (;;) {
    for (const marker of ROOT_MARKERS) {
      // join() with a '/'-containing marker is fine on both platforms.
      if (fs.existsSync(join(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;      // hit the filesystem root
    dir = parent;
  }
}

/**
 * A deliberately small frontmatter reader.
 *
 * Handles `key: value` on one line, plus `>` and `|` block scalars, which is
 * every shape the real rosters actually use. It does NOT handle nested maps or
 * block lists, and it returns what it understood rather than throwing: a skill
 * with an exotic header should cost us that one skill, not the whole inventory.
 * Callers that need a field must check for it.
 */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;                    // indented, list item, or continuation
    let value = kv[2].trim();

    /* A block scalar: `key: >` or `key: |`, optionally chomped (`>-`, `|+`),
       with the value on the following INDENTED lines.
       Reading the marker as the value is not a harmless parse gap. People fold
       precisely because a description is long, so this silently discarded the
       most informative descriptions in the inventory and handed the fit review
       the string ">" as though that were what the agent does. Four items in the
       real Clembot roster, including three skills. */
    const block = /^([>|])([-+]?)$/.exec(value);
    if (block) {
      const folded = block[1] === '>';
      const body = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (next.trim() !== '' && !/^\s/.test(next)) break;   // back to column 0
        body.push(next.trim());
        i++;
      }
      while (body.length && body[body.length - 1] === '') body.pop();
      // Folded joins with spaces and treats a blank line as a paragraph break;
      // literal keeps the line breaks.
      value = folded
        ? body.reduce((acc, ln) => (ln === '' ? acc + '\n' : (acc && !acc.endsWith('\n') ? acc + ' ' : acc) + ln), '')
        : body.join('\n');
      out[kv[1]] = value.trim();
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[kv[1]] = value;
  }
  return out;
}

/**
 * Every MCP server an agent can actually reach, named the way the gate names it.
 *
 * A tool reads `mcp__<server>__<tool>`, so the server identity is sitting in the
 * agent's own frontmatter. Collecting only `.mcp.json` missed it entirely: the
 * real Clembot project has ZERO `.mcp.json` files and one agent holding fifteen
 * `mcp__claude_ai_Canva__*` tools.
 *
 * That was not a cosmetic gap. `validateVerdict` builds its known-names set from
 * this list, so a fit review correctly answering "you already have Canva" was
 * rejected as an invented overlap and then failed loudly. A guard built against
 * a fixture refusing a true statement about reality.
 */
export function mcpServersFromTools(agents) {
  const seen = new Map();
  for (const a of agents) {
    for (const t of a.tools ?? []) {
      const m = /^mcp__([A-Za-z0-9_.-]+?)__/.exec(t);
      if (!m) continue;
      const name = m[1];
      if (!seen.has(name)) seen.set(name, { name, url: null, heldBy: [], tools: 0, sources: ['agent tools'] });
      const entry = seen.get(name);
      entry.tools++;
      if (!entry.heldBy.includes(a.name)) entry.heldBy.push(a.name);
    }
  }
  return [...seen.values()];
}

/** `tools: Read, Grep, mcp__x__y` -> ['Read', 'Grep', 'mcp__x__y'] */
function splitList(value) {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed === '[]' || trimmed === '') return [];
  return trimmed
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function readDirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readFileSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Collect the inventory.
 *
 * `registryDir` is separate from `root` because the registry belongs to the
 * doorman and the agents belong to the host project. In the giveaway those are
 * different directories, and conflating them is how you end up reading an
 * allowlist that is not the one the gate reads.
 */
export function gatherInventory({ root, registryDir, claudeMdCap = CLAUDE_MD_CAP } = {}) {
  const agents = [];
  const skills = [];
  const mcpServers = [];
  const allowlisted = [];
  const notes = [];

  // What this reader could actually SEE here. `0 agents` in a Claude Code
  // project is a fact; the same 0 in a Cursor project is an artefact of asking
  // the wrong question, and a caller must be able to tell those apart.
  const coverage = { agents: 'unknown', skills: 'unknown', mcpServers: 'unknown' };

  if (!root) {
    notes.push('no inventory root was found: agents and skills are UNKNOWN, not empty');
  } else {
    const hasAgentLayout = existsSync(join(root, '.claude', 'agents')) ||
                           existsSync(join(root, '.agents'));
    const hasSkillLayout = SKILL_SOURCES.some((rel) => existsSync(join(root, rel)));
    if (hasAgentLayout) coverage.agents = 'read';
    if (hasSkillLayout) coverage.skills = 'read';
    if (!hasAgentLayout && !hasSkillLayout) {
      notes.push(
        'this project has no .claude/agents or known skills directory, so its subagents and ' +
        'skills are UNKNOWN rather than absent. Only the MCP config was read.',
      );
    }
    const agentDir = join(root, '.claude', 'agents');
    for (const file of readDirSafe(agentDir).filter((f) => f.endsWith('.md'))) {
      const text = readFileSafe(join(agentDir, file));
      const fm = text && parseFrontmatter(text);
      if (!fm) {
        notes.push(`agent file ${file} has no readable frontmatter and was skipped`);
        continue;
      }
      agents.push({
        name: fm.name ?? file.replace(/\.md$/, ''),
        description: fm.description ?? '',
        tools: splitList(fm.tools),
        skills: splitList(fm.skills),
      });
    }

    const seenSkills = new Set();
    for (const rel of SKILL_SOURCES) {
      const skillsDir = join(root, rel);
      if (!existsSync(skillsDir)) continue;
      for (const entry of readDirSafe(skillsDir)) {
        const skillFile = join(skillsDir, entry, 'SKILL.md');
        const text = readFileSafe(skillFile);
        const fm = text && parseFrontmatter(text);
        if (!fm) continue;                  // not every directory is a skill
        const name = fm.name ?? entry;
        if (!seenSkills.has(name)) {
          seenSkills.add(name);
          skills.push({ name, description: fm.description ?? '', source: rel });
        }
      }
    }

    /* Every place a server gets configured, not just the Claude Code one.
       `doctor` has read all of these since it shipped; this did not, so `watch`
       told a Cursor user that two servers listed in their own
       `.cursor/mcp.json` were "new to this build". Both surfaces read the same
       list now. `MCP_CONFIG_SOURCES` is exported so the drift is visible if the
       two ever diverge again. */
    for (const rel of MCP_CONFIG_SOURCES) {
      const mcpText = readFileSafe(join(root, rel));
      if (!mcpText) continue;
      try {
        const doc = JSON.parse(mcpText);
        // `mcpServers` is the Claude/Cursor spelling, `servers` the VS Code one.
        const declared = { ...(doc.mcpServers ?? {}), ...(doc.servers ?? {}) };
        for (const [name, cfg] of Object.entries(declared)) {
          const url = cfg?.url ?? cfg?.serverUrl ?? null;
          const existing = mcpServers.find((m) => m.name === name);
          if (existing) {
            // Two files can declare the same server. Keep the first url found
            // rather than letting a later file with no url erase it.
            if (!existing.url && url) existing.url = url;
            if (!existing.sources.includes(rel)) existing.sources.push(rel);
          } else {
            mcpServers.push({ name, url, heldBy: [], tools: 0, sources: [rel] });
          }
        }
        coverage.mcpServers = 'read';
      } catch {
        notes.push(`${rel} exists but did not parse; configured servers are UNKNOWN`);
      }
    }

    /* Union with what the agents actually hold. `.mcp.json` is one way a server
       gets configured and it is not the only one. */
    for (const derived of mcpServersFromTools(agents)) {
      const existing = mcpServers.find((m) => m.name === derived.name);
      if (existing) {
        existing.heldBy = derived.heldBy;
        existing.tools = derived.tools;
      } else {
        mcpServers.push(derived);
      }
    }
  }

  if (registryDir) {
    const text = readFileSafe(join(registryDir, 'allowlist.json'));
    if (text) {
      try {
        const doc = JSON.parse(text);
        for (const [key, entry] of Object.entries(doc.servers ?? {})) {
          allowlisted.push({ key, url: entry?.url ?? null, grade: entry?.grade ?? null });
        }
      } catch {
        notes.push('allowlist.json did not parse; already-graded servers are UNKNOWN');
      }
    }
  }

  let claudeMd = '';
  let claudeMdTruncated = false;
  if (root) {
    const text = readFileSafe(join(root, 'CLAUDE.md'));
    if (text) {
      claudeMd = text.slice(0, claudeMdCap);
      claudeMdTruncated = text.length > claudeMdCap;
    }
  }

  return {
    root: root ?? null,
    agents,
    skills,
    mcpServers,
    allowlisted,
    claudeMd,
    claudeMdTruncated,
    coverage,
    notes,
  };
}

/**
 * Render the inventory as the context block the model sees.
 *
 * Deterministic ordering, because a fit verdict at temperature 0 should not
 * change because a directory listing came back in a different order.
 *
 * Truncation is ANNOUNCED. A model told it is seeing a partial CLAUDE.md can
 * hedge; a model shown a silently clipped one cannot.
 */
export function renderInventory(inv) {
  const lines = [];
  const by = (a, b) => (a.name ?? a.key).localeCompare(b.name ?? b.key);

  lines.push('# SUBAGENTS');
  if (inv.agents.length === 0) lines.push('(none found)');
  for (const a of [...inv.agents].sort(by)) {
    lines.push(`- ${a.name}: ${a.description}`);
    if (a.tools.length) lines.push(`    tools: ${a.tools.join(', ')}`);
    if (a.skills.length) lines.push(`    skills: ${a.skills.join(', ')}`);
  }

  lines.push('', '# SKILLS');
  if (inv.skills.length === 0) lines.push('(none found)');
  for (const s of [...inv.skills].sort(by)) lines.push(`- ${s.name}: ${s.description}`);

  lines.push('', '# MCP SERVERS ALREADY CONFIGURED');
  if (inv.mcpServers.length === 0) lines.push('(none)');
  for (const m of [...inv.mcpServers].sort(by)) {
    const held = m.heldBy && m.heldBy.length ? ` (held by ${m.heldBy.join(', ')}, ${m.tools} tools)` : '';
    lines.push(`- ${m.name}: ${m.url ?? 'no url'}${held}`);
  }

  lines.push('', '# MCP SERVERS ALREADY GRADED AND ALLOWLISTED');
  if (inv.allowlisted.length === 0) lines.push('(none)');
  for (const a of [...inv.allowlisted].sort((x, y) => x.key.localeCompare(y.key))) {
    lines.push(`- ${a.key} (${a.grade ?? 'ungraded'}): ${a.url ?? 'no url'}`);
  }

  lines.push('', '# PROJECT CLAUDE.md');
  lines.push(inv.claudeMd || '(not found)');
  if (inv.claudeMdTruncated) {
    lines.push('', `[TRUNCATED at ${CLAUDE_MD_CAP} bytes. You are seeing the beginning only.]`);
  }

  if (inv.notes.length) {
    lines.push('', '# GAPS IN THIS INVENTORY');
    for (const n of inv.notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
}

/** Convenience for callers that just want the inventory for a directory. */
export function inventoryFor(startDir, { registryDir, env = process.env } = {}) {
  const root = findInventoryRoot(startDir, { env });
  return gatherInventory({ root, registryDir });
}

export const __testing = { splitList, readDirSafe, statSync };
