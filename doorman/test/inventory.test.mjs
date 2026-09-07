/**
 * Inventory gathering.
 *
 * Reads a fixture project on disk rather than a mock filesystem, because the
 * things that actually break here are filesystem-shaped: a directory under
 * skills/ that is not a skill, an agent file with no frontmatter, a quoted
 * description containing a colon.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, describe } from './harness.mjs';
import {
  CLAUDE_MD_CAP,
  findInventoryRoot,
  gatherInventory,
  mcpServersFromTools,
  parseFrontmatter,
  renderInventory,
} from '../src/inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', 'test-fixtures', 'project');

const inv = gatherInventory({ root: ROOT, registryDir: join(ROOT, 'registry') });

describe('inventory: what it collects');
{
  check('reads agents with frontmatter', inv.agents.length === 4, String(inv.agents.length));
  const researcher = inv.agents.find((a) => a.name === 'researcher');
  check('captures the description', /Fetches web pages/.test(researcher.description));
  check('splits the tools list', researcher.tools.join('|') === 'Read|WebFetch|WebSearch',
    researcher.tools.join('|'));
  check('an empty skills list is empty, not [""]',
    researcher.skills.length === 0, JSON.stringify(researcher.skills));

  const scheduler = inv.agents.find((a) => a.name === 'scheduler');
  check('a quoted description containing a colon survives',
    scheduler.description === 'Plans work across a week: sequencing, not integrations.',
    scheduler.description);
}
{
  check('reads skills', inv.skills.length === 2, String(inv.skills.length));
  check('a directory under skills/ with no SKILL.md is not a skill',
    !inv.skills.some((x) => x.name === 'not-a-skill'),
    JSON.stringify(inv.skills.map((s) => s.name)));
}
{
  check('reads configured mcp servers', inv.mcpServers.length === 3, String(inv.mcpServers.length));
  check('reads the allowlist from the registry dir, not the project root',
    inv.allowlisted.length === 1 && inv.allowlisted[0].grade === 'A',
    JSON.stringify(inv.allowlisted));
}

describe('inventory: block scalars');
{
  /* Both bugs in this section were found by pointing the gatherer at the REAL
     Clembot roster instead of a fixture, and both would have degraded the demo.
     The fixtures are shaped like what was actually there. */
  const folded = inv.agents.find((a) => a.name === 'thoughts-publisher');
  check('a folded `>` description is read, not the marker',
    folded && folded.description.startsWith('Publishes an approved Notion'),
    JSON.stringify(folded && folded.description.slice(0, 40)));
  check('folded lines are joined with spaces, not concatenated',
    folded && folded.description.includes('Contents API. Converts to Markdown'),
    JSON.stringify(folded && folded.description.slice(60, 120)));
  // The failure this replaces: the value came back as ">" and the real text was
  // dropped. People fold BECAUSE a description is long, so it lost exactly the
  // most informative ones.
  check('a folded description is never just the marker',
    folded && folded.description !== '>' && folded.description.length > 40);

  const lit = inv.skills.find((x) => x.name === 'literal-block');
  check('a literal `|` block keeps its line breaks',
    lit && lit.description.split('\n').length === 2, JSON.stringify(lit && lit.description));

  check('a plain one-line value still works',
    parseFrontmatter('---\nname: x\ndescription: hello\n---\n').description === 'hello');
  check('a key AFTER a block scalar is still parsed',
    parseFrontmatter('---\ndescription: >\n  folded text\ntools: Read, Write\n---\n').tools === 'Read, Write');
  check('a chomped marker is still a block scalar',
    parseFrontmatter('---\ndescription: >-\n  chomped text\n---\n').description === 'chomped text');
}

describe('inventory: MCP servers held in agent frontmatter');
{
  /* The worse of the two. Real Clembot has ZERO .mcp.json files and one agent
     holding fifteen mcp__claude_ai_Canva__* tools, so collecting only from
     .mcp.json reported none at all. validateVerdict builds its known-names set
     from this list, so a fit review correctly citing Canva as an existing
     overlap was rejected as invented and then failed loudly: a guard built
     against a fixture refusing a true statement about reality. */
  const canva = inv.mcpServers.find((m) => m.name === 'claude_ai_Canva');
  check('a server is discovered from an agent tool name', Boolean(canva),
    JSON.stringify(inv.mcpServers.map((m) => m.name)));
  check('it counts the tools', canva && canva.tools === 2, String(canva && canva.tools));
  check('it records who holds it',
    canva && canva.heldBy.includes('design-director'), JSON.stringify(canva && canva.heldBy));
  check('a second server on the same agent is separate',
    inv.mcpServers.some((m) => m.name === 'other_server'),
    JSON.stringify(inv.mcpServers.map((m) => m.name)));
  check('a server from .mcp.json is still present',
    inv.mcpServers.some((m) => m.name === 'scorecard'),
    JSON.stringify(inv.mcpServers.map((m) => m.name)));
  check('the rendered block names who holds it',
    /claude_ai_Canva.*held by design-director, 2 tools/.test(renderInventory(inv)));

  check('an agent with no mcp tools yields none',
    mcpServersFromTools([{ name: 'a', tools: ['Read', 'Grep'] }]).length === 0);
  check('a malformed mcp tool name is ignored, not half-parsed',
    mcpServersFromTools([{ name: 'a', tools: ['mcp__nounderscores'] }]).length === 0);
}

describe('inventory: what it refuses to guess');
{
  // A file it could not read must become a stated gap. Dropping it silently
  // would let the model conclude "no such agent exists" from our parse error.
  check('an agent file with no frontmatter is skipped AND noted',
    inv.notes.some((n) => /broken\.md/.test(n)), inv.notes.join(' | '));
}
{
  const empty = gatherInventory({});
  check('no root at all is UNKNOWN, not empty',
    empty.notes.some((n) => /UNKNOWN, not empty/.test(n)), empty.notes.join(' | '));
}

describe('inventory: the CLAUDE.md cap');
{
  const capped = gatherInventory({ root: ROOT, claudeMdCap: 10 });
  check('a long CLAUDE.md is truncated', capped.claudeMd.length === 10, String(capped.claudeMd.length));
  check('truncation is flagged', capped.claudeMdTruncated === true);
  check('and the rendered block SAYS it was truncated',
    /TRUNCATED at \d+ bytes/.test(renderInventory(capped)));
  check('an untruncated CLAUDE.md says nothing about truncation',
    !/TRUNCATED/.test(renderInventory(inv)));
  check('the default cap is a real number', CLAUDE_MD_CAP > 0);
}

describe('inventory: the rendered block');
{
  const block = renderInventory(inv);
  check('names every section the prompt refers to',
    ['# SUBAGENTS', '# SKILLS', '# MCP SERVERS ALREADY CONFIGURED',
     '# MCP SERVERS ALREADY GRADED AND ALLOWLISTED', '# PROJECT CLAUDE.md']
      .every((h) => block.includes(h)), block.slice(0, 80));
  check('lists an agent with its tools', /- researcher: .*\n\s+tools: Read, WebFetch, WebSearch/.test(block));
  check('surfaces the gaps section when there are gaps', block.includes('# GAPS IN THIS INVENTORY'));

  // Temperature 0 should mean the same inventory renders identically. A block
  // whose order follows readdir would change the prompt between runs on a
  // different filesystem and quietly make two verdicts incomparable.
  const again = renderInventory(gatherInventory({ root: ROOT, registryDir: join(ROOT, 'registry') }));
  check('rendering is deterministic', again === block);
  const shuffled = { ...inv, agents: [...inv.agents].reverse(), skills: [...inv.skills].reverse() };
  check('and independent of input order', renderInventory(shuffled) === block);
}

describe('inventory: frontmatter parsing');
{
  check('no frontmatter returns null', parseFrontmatter('# just a heading') === null);
  check('reads a simple pair', parseFrontmatter('---\nname: x\n---\n').name === 'x');
  check('strips single quotes', parseFrontmatter("---\nname: 'x'\n---\n").name === 'x');
  check('ignores indented continuation lines',
    parseFrontmatter('---\nname: x\n  nested: y\n---\n').nested === undefined);
  check('tolerates CRLF', parseFrontmatter('---\r\nname: x\r\n---\r\n').name === 'x');
}

describe('inventory: finding the root');
{
  const found = findInventoryRoot(join(ROOT, '.claude', 'agents'));
  check('walks up to the directory holding .claude/agents', found === ROOT, String(found));
  check('an explicit DOORMAN_INVENTORY_ROOT wins over the walk',
    findInventoryRoot('/anywhere', { env: { DOORMAN_INVENTORY_ROOT: ROOT } }) === ROOT);
}
