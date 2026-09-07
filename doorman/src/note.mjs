/**
 * The review note. One markdown file, one page, the human approval surface.
 *
 * ── Nothing auto-approves ────────────────────────────────────────────────────
 *
 * `status: pending` is the resting state and this module only ever writes that.
 * A person flips it to `approved` or `denied` by editing the frontmatter, and
 * the poller acts on the flip. Nothing here writes `approved`, ever.
 *
 * ── It never loses a report ──────────────────────────────────────────────────
 *
 * If the vault path is unset or unwritable the note goes to `registry/reviews/`
 * with a warning. A review that vanished because a path was wrong is worse than
 * a review in the wrong folder.
 *
 * ── It only ever creates and appends ─────────────────────────────────────────
 *
 * The vault belongs to the human. This writes new notes and appends to the
 * decision log of notes it wrote. It never edits or deletes anything else.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { candidateSlug } from './candidate.mjs';

/** A page. Same reasoning as the scorecard's report: enforced, not aspirational. */
export const MAX_NOTE_LINES = 72;

/** Where notes go inside the vault. */
export const VAULT_SUBDIR = join('clembot-doorman', 'reviews');

function yamlString(v) {
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  // Quote anything YAML would misread. A description with a colon in it is the
  // common case and it silently truncates the value otherwise.
  return /[:#\n"']/.test(s) ? JSON.stringify(s) : s;
}

/**
 * Render the note.
 *
 * @param {object} r  a runVet result
 * @returns {{ filename: string, body: string, truncated: boolean }}
 */
export function renderNote(r, { now = () => new Date() } = {}) {
  const c = r.candidate;
  const date = r.reviewed ?? now().toISOString().slice(0, 10);
  const g = r.grade;

  const front = [
    '---',
    `candidate: ${yamlString(c.id)}`,
    `type: ${c.type}`,
    `fit: ${r.fit ? r.fit.verdict : 'null'}`,
    `owner: ${yamlString(r.fit && r.fit.owner)}`,
    `grade: ${yamlString(g && g.grade)}`,
    `cost_usdc: ${r.cost_usdc ?? 0}`,
    `evidence_hash: ${yamlString(g && g.evidence_sha256)}`,
    'status: pending',
    `reviewed: ${date}`,
    '---',
    '',
  ];

  const head = [`# ${c.id}`, ''];

  const tldr = ['## Verdict', ''];
  if (r.fit) {
    tldr.push(`**${r.fit.verdict}**. ${r.fit.rationale}`);
    if (r.fit.verdict === 'fits' && r.fit.owner) {
      tldr.push('', `Scoped to \`${r.fit.owner}\`.`);
    }
  } else {
    tldr.push('No fit review ran.');
  }
  tldr.push('');

  const overlap = ['## Overlap', ''];
  if (r.fit && r.fit.overlaps.length) {
    overlap.push('| Kind | Name | Already covers |', '|---|---|---|');
    for (const o of r.fit.overlaps) overlap.push(`| ${o.kind} | \`${o.name}\` | ${o.why} |`);
  } else {
    overlap.push('Nothing in the current inventory covers this.');
  }
  overlap.push('');

  const placement = ['## Placement', ''];
  if (r.fit && r.fit.verdict === 'fits') {
    placement.push(`\`${r.fit.owner}\` gets the tool. No other subagent is changed.`);
    placement.push('');
    placement.push('> Scoping here is **recorded, not enforced**. The gate matches every');
    placement.push('> `mcp__*` call and reads only the tool name, so it cannot tell which');
    placement.push('> subagent is calling. Treat `owner` as the intent, not a boundary.');
  } else if (r.fit && r.fit.verdict === 'needs-new-subagent') {
    placement.push('No existing subagent is the right home. A new one would have to be');
    placement.push('created before this is worth adding.');
  } else {
    placement.push('Not placed: the fit review stopped before placement.');
  }
  placement.push('');

  const scorecard = ['## Scorecard', ''];
  if (g) {
    scorecard.push(`**${g.grade} ${g.score}/100** against \`${g.model}\`.`);
    const L = g.layers ?? {};
    scorecard.push('', `Static ${fmt(L.static_pct)} · behavioural ${fmt(L.behavioral_pct)} · guidance ${fmt(L.guidance_pct)}`);
    if (g.hard_fail) scorecard.push('', `**Hard fail:** ${g.hard_fail}`);
    const worst = (g.grade_json && g.grade_json.worst_failure_modes) || [];
    if (worst.length) {
      scorecard.push('');
      for (const w of worst.slice(0, 3)) scorecard.push(`- ${w}`);
    }
    if (r.transcripts) scorecard.push('', `[Replay the tape](${r.transcripts})`);
  } else if (r.scan) {
    scorecard.push('**behavioral grade: n/a - no tools to probe.**');
    scorecard.push('', `Scanned ${r.scan.scanned_chars} chars of instruction text from \`${r.scan.source}\`${r.scan.truncated ? ' (TRUNCATED, so this is a partial scan)' : ''}.`);
    scorecard.push('', r.scan.hits.length
      ? `${r.scan.hard} hard, ${r.scan.steering} steering:`
      : 'No pattern fired.');
    for (const fmode of r.scan.failure_modes.slice(0, 4)) scorecard.push(`- ${fmode}`);
  } else if (r.audit_id) {
    scorecard.push('Queued, not yet graded. There is no grade here and no estimate of one.');
    if (r.transcripts) scorecard.push('', `Tape (once it exists): ${r.transcripts}`);
  } else {
    scorecard.push('Not graded. The fit review stopped before the paid phase, which is');
    scorecard.push('the point: a redundant candidate costs nothing.');
  }
  scorecard.push('');

  const recipe = ['## Recipe', ''];
  const recipeText = (g && g.recipe_md) || '';
  if (recipeText) recipe.push(...recipeText.trim().split('\n'));
  else recipe.push('_No recipe drafted._');
  recipe.push('');

  const log = [
    '## Decision log', '',
    `- ${date} · review written by the doorman · status \`pending\``,
    '',
  ];

  // Trim the recipe FIRST, per the brief. It is the only section whose loss
  // costs context rather than a claim.
  let body = [...front, ...head, ...tldr, ...overlap, ...placement, ...scorecard, ...recipe, ...log];
  let truncated = false;
  while (body.length > MAX_NOTE_LINES && recipe.length > 3) {
    recipe.splice(recipe.length - 2, 1);
    truncated = true;
    body = [...front, ...head, ...tldr, ...overlap, ...placement, ...scorecard, ...recipe, ...log];
  }
  if (truncated) {
    recipe.splice(recipe.length - 1, 0, '', '_Recipe trimmed to hold one page. Full text is on the audit._');
    body = [...front, ...head, ...tldr, ...overlap, ...placement, ...scorecard, ...recipe, ...log];
  }

  return {
    filename: `${candidateSlug(c)}-${date}.md`,
    body: body.join('\n').replace(/\n{3,}/g, '\n\n') + '\n',
    truncated,
  };
}

/**
 * Write it. Vault first, registry fallback second, never nowhere.
 *
 * @returns {{ path: string, fellBack: boolean, warning: string|null }}
 */
export function writeNote(r, { vaultPath, registryDir, fs, now } = {}) {
  const io = fs ?? { existsSync, mkdirSync, writeFileSync };
  const { filename, body, truncated } = renderNote(r, { now });

  const targets = [];
  if (vaultPath) targets.push({ dir: join(vaultPath, VAULT_SUBDIR), vault: true });
  if (registryDir) targets.push({ dir: join(registryDir, 'reviews'), vault: false });

  let warning = null;
  for (const t of targets) {
    try {
      io.mkdirSync(t.dir, { recursive: true });
      const path = join(t.dir, filename);
      io.writeFileSync(path, body, 'utf8');
      return { path, fellBack: !t.vault, truncated, warning };
    } catch (e) {
      warning = `could not write to ${t.dir} (${e.message})`;
      if (t.vault) {
        warning += '; falling back to the registry so the report is not lost';
      }
    }
  }
  throw new Error('nowhere to write the review note. ' + (warning ?? 'no target given'));
}

/**
 * Append one line to a note's decision log.
 *
 * The ONLY mutation this module makes to an existing file, and it is additive.
 * A note whose log cannot be found is left alone and reported, rather than
 * having a log section invented at the end of somebody's document.
 */
export function appendDecision(path, line, { fs } = {}) {
  const io = fs ?? { readFileSync, appendFileSync };
  const text = io.readFileSync(path, 'utf8');
  if (!/^## Decision log$/m.test(text)) {
    return { appended: false, reason: 'no "## Decision log" heading in that note' };
  }
  io.appendFileSync(path, `- ${line}\n`, 'utf8');
  return { appended: true };
}

function fmt(v) {
  return v === null || v === undefined ? '_not measured_' : `${v}%`;
}
