/**
 * The scaffold units a build already has: its commands, agents and skills.
 *
 * `inventory.mjs` gathers agents, skills and MCP servers for the FIT review,
 * and deliberately reads frontmatter only. This reads the same kind of thing
 * for a different question, and adds commands, which nothing needed until
 * `repeats` started asking whether a retyped procedure already had one.
 *
 * Kept in one place because two readers of the same directories drift, and the
 * one that drifted would be the one still passing its tests. Same reasoning as
 * invariant 2, pointed at a file read instead of at grade math.
 *
 * Frontmatter only, same as inventory: reading every body is hundreds of
 * kilobytes to answer a question the description already answers.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './inventory.mjs';

/** Where each kind lives, across the harnesses that have a convention for it. */
const UNIT_DIRS = [
  ['command', ['.claude/commands']],
  ['agent', ['.claude/agents', '.agents']],
];

const SKILL_DIRS = ['.claude/skills', '.agents/skills', 'skills'];

export function gatherUnits(root, { fs = { readdirSync, readFileSync, existsSync } } = {}) {
  const units = [];

  for (const [kind, bases] of UNIT_DIRS) {
    for (const base of bases) {
      let files = [];
      try {
        files = fs.readdirSync(join(root, base)).filter((f) => f.endsWith('.md'));
      } catch { continue; }
      for (const f of files) {
        let body = '';
        try { body = fs.readFileSync(join(root, base, f), 'utf8'); } catch { continue; }
        const fm = parseFrontmatter(body) ?? {};
        units.push({
          kind,
          name: f.replace(/\.md$/, ''),
          description: fm.description ?? fm.name ?? '',
          source: `${base}/${f}`,
        });
      }
    }
  }

  // A skill is a directory with a SKILL.md inside, not a loose file.
  for (const base of SKILL_DIRS) {
    let entries = [];
    try { entries = fs.readdirSync(join(root, base)); } catch { continue; }
    for (const e of entries) {
      const f = join(root, base, e, 'SKILL.md');
      if (!fs.existsSync(f)) continue;
      let body = '';
      try { body = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const fm = parseFrontmatter(body) ?? {};
      units.push({
        kind: 'skill',
        name: fm.name ?? e,
        description: fm.description ?? '',
        source: `${base}/${e}/SKILL.md`,
      });
    }
  }

  return units;
}

/** How many kinds are actually represented. A setup with only one has not found the others. */
export function kindsPresent(units) {
  return [...new Set(units.map((u) => u.kind))].sort();
}

/**
 * The facts the practice half of the grade needs, gathered in one place so the
 * grader stays pure.
 *
 * `scaffolded` is null when it was not measured, which is different from zero
 * and has to stay different: `doctor` advertises itself as offline and under
 * five milliseconds, and clustering several hundred prompts is neither. So
 * doctor passes nothing and the check reports n/a with the reason, while
 * `dashboard` and `audit`, which already read history, pass the real numbers.
 */
export function practiceFacts(root, { units = null, repeatResult = null, fs } = {}) {
  const u = units ?? gatherUnits(root, fs ? { fs } : {});

  let scaffolded = null;
  if (repeatResult && repeatResult.ok) {
    const cross = (repeatResult.clusters || []).filter((c) => c.kind === 'cross-session');
    scaffolded = {
      total: cross.length,
      covered: cross.filter((c) => c.covered).length,
      prompts: repeatResult.prompts ?? null,
    };
  }

  return { units: u, kinds: kindsPresent(u), scaffolded };
}
