/**
 * The harness surface, and nothing else.
 *
 * ── What this is allowed to read ─────────────────────────────────────────────
 *
 * A closed list, declared below as data so it can be audited at a glance
 * rather than traced through control flow. Source code, `.env`, secrets,
 * anything outside the repo root, and anything not on the list are never
 * opened. This runs on a prospect's machine inside their firewall, so the
 * interesting property is not what it collects, it is what it cannot.
 *
 * Symlinks are resolved and re-checked against the root. A symlink is the one
 * way an allowed path can name a file outside the tree, and "we only read
 * .claude/" stops being true the moment one points at `~/.ssh`.
 *
 * ── Fail closed ──────────────────────────────────────────────────────────────
 *
 * A file that exists and will not parse is recorded as a PROBLEM and counts
 * against the dimension it belongs to, never for it. The alternative is that a
 * malformed `settings.json` reads as "no dangerous permissions found", which is
 * the same sentence a clean one produces. Same reasoning as the gate's rule 3.
 *
 * ── Receipts ─────────────────────────────────────────────────────────────────
 *
 * Every check has to point at a file and a line, or say `absent`. So each file
 * is kept as its raw text split into lines, and `lineOf` finds the first line
 * matching a pattern. A finding nobody can look up is an assertion, and
 * invariant 9 is about exactly that.
 */

import { readFileSync, readdirSync, statSync, realpathSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * The closed list. `dir` entries read one level of matching files; `file`
 * entries read exactly one path.
 *
 * `.claude/hooks` is read as NAMES ONLY (`content: false`). A hook is a shell
 * script and its body is code, which is outside the surface; that a hook
 * exists and what it is wired to is configuration, which is inside it.
 */
export const SURFACE = [
  { kind: 'file', id: 'claude_md', path: 'CLAUDE.md' },
  { kind: 'file', id: 'agents_md', path: 'AGENTS.md' },
  { kind: 'file', id: 'settings', path: '.claude/settings.json', json: true },
  { kind: 'file', id: 'settings_local', path: '.claude/settings.local.json', json: true },
  { kind: 'file', id: 'mcp', path: '.mcp.json', json: true },
  { kind: 'file', id: 'installed', path: '.claude/skills/INSTALLED.md' },
  { kind: 'dir', id: 'agents', path: '.claude/agents', match: /\.md$/ },
  { kind: 'dir', id: 'commands', path: '.claude/commands', match: /\.md$/ },
  { kind: 'dir', id: 'rules', path: '.claude/rules', match: /\.md$/ },
  { kind: 'dir', id: 'hooks', path: '.claude/hooks', match: /.*/, content: false },
  { kind: 'skills', id: 'skills', path: '.claude/skills' },
  // Doorman's OWN registry. Omitting this made `vet-registry` blind to the one
  // registry format this tool ships: a gated harness records its servers here,
  // not in prose under .claude/rules/, so doorman scored a doorman-gated repo
  // 0/4 on tool vetting for using doorman. Server names and grades only, which
  // is the same class of content as .mcp.json directly above.
  { kind: 'file', id: 'doorman_allowlist', path: 'registry/allowlist.json', json: true },
];

/** Files this must never open even if something above would reach them. */
export const NEVER = [/\.env(\..*)?$/i, /\.pem$/i, /id_rsa/i, /\.key$/i, /credentials/i];

const isBlocked = (p) => NEVER.some((re) => re.test(p));

/** One read file, kept with its lines so a check can cite one. */
function readOne(root, rel, { json = false, content = true } = {}) {
  const abs = join(root, rel);
  if (isBlocked(rel)) return null;
  if (!existsSync(abs)) return null;

  // A symlink pointing out of the tree is the one way an allowed path reaches
  // a file the surface never declared. Resolve, then re-check containment.
  let real;
  try { real = realpathSync(abs); } catch { return { path: rel, problem: 'unreadable' }; }
  const rootReal = realpathSync(root);
  if (real !== rootReal && !real.startsWith(rootReal + sep)) {
    return { path: rel, problem: 'symlink-escapes-repo' };
  }

  if (!content) return { path: rel, lines: [], raw: '', namesOnly: true };

  let raw;
  try { raw = readFileSync(real, 'utf8'); } catch { return { path: rel, problem: 'unreadable' }; }

  const file = { path: rel, raw, lines: raw.split('\n') };
  if (json) {
    try { file.json = JSON.parse(raw); } catch { file.problem = 'unparseable-json'; }
  }
  return file;
}

function listDir(root, rel, match) {
  try {
    return readdirSync(join(root, rel))
      .filter((f) => match.test(f))
      .filter((f) => !isBlocked(join(rel, f)))
      .sort();
  } catch { return []; }
}

/**
 * Read the surface.
 *
 * @returns {{root, files: Map, problems: Array, counts: object}}
 */
export function readSurface(root) {
  root = resolve(root);
  const files = new Map();
  const problems = [];

  const keep = (f) => {
    if (!f) return;
    files.set(f.path, f);
    if (f.problem) problems.push({ path: f.path, problem: f.problem });
  };

  for (const entry of SURFACE) {
    if (entry.kind === 'file') {
      keep(readOne(root, entry.path, entry));
    } else if (entry.kind === 'dir') {
      for (const name of listDir(root, entry.path, entry.match)) {
        keep(readOne(root, join(entry.path, name).split(sep).join('/'), entry));
      }
    } else if (entry.kind === 'skills') {
      let dirs = [];
      try { dirs = readdirSync(join(root, entry.path)); } catch { dirs = []; }
      for (const d of dirs.sort()) {
        const rel = `${entry.path}/${d}/SKILL.md`;
        try { if (!statSync(join(root, entry.path, d)).isDirectory()) continue; } catch { continue; }
        keep(readOne(root, rel, {}));
      }
    }
  }

  const of = (prefix) => [...files.keys()].filter((p) => p.startsWith(prefix));

  return {
    root,
    files,
    problems,
    counts: {
      agents: of('.claude/agents/').length,
      commands: of('.claude/commands/').length,
      rules: of('.claude/rules/').length,
      hooks: of('.claude/hooks/').length,
      skills: of('.claude/skills/').filter((p) => p.endsWith('/SKILL.md')).length,
    },
  };
}

/** Every read file under a prefix, in path order. */
export function filesUnder(surface, prefix) {
  return [...surface.files.values()].filter((f) => f.path.startsWith(prefix) && !f.problem);
}

export function fileAt(surface, path) {
  const f = surface.files.get(path);
  return f && !f.problem ? f : null;
}

/**
 * First 1-based line in `file` matching `re`, or null.
 *
 * One-based because a receipt is read by a human opening an editor, and every
 * editor counts from one.
 */
export function lineOf(file, re) {
  if (!file || !file.lines) return null;
  for (let i = 0; i < file.lines.length; i++) if (re.test(file.lines[i])) return i + 1;
  return null;
}

/** A receipt: where a check looked, and what it found there. */
export function receipt(file, re) {
  if (!file) return 'absent';
  const line = re ? lineOf(file, re) : null;
  return line ? `${file.path}:${line}` : file.path;
}

/**
 * Frontmatter, reusing the hand-rolled parser the rest of the tool uses.
 *
 * Imported rather than re-implemented: `inventory.mjs` already handles block
 * scalars and returns what it understood rather than throwing, and a second
 * parser would drift from it on exactly the files both of them read.
 */
export { parseFrontmatter } from '../inventory.mjs';
