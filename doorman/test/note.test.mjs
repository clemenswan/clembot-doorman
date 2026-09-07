/**
 * The review note.
 *
 * Two properties carry the weight: it never writes `approved`, and it never
 * loses a report. Everything else is rendering.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import { MAX_NOTE_LINES, appendDecision, renderNote, writeNote } from '../src/note.mjs';

const base = (over = {}) => ({
  candidate: { id: 'https://mcp.fetcher.example/mcp', type: 'mcp-server', host: 'mcp.fetcher.example' },
  reviewed: '2026-09-03',
  fit: { verdict: 'redundant', owner: null, rationale: 'The researcher already fetches pages.',
         overlaps: [{ kind: 'agent', name: 'researcher', why: 'holds WebFetch' }] },
  scan: null, grade: null, audit_id: null, transcripts: null,
  cost_usdc: 0, paid: false, stopped_at: 'fit',
  ...over,
});

describe('note: frontmatter');
{
  const { body, filename } = renderNote(base());
  const fm = body.split('---')[1];
  check('carries every key the poller reads',
    ['candidate:', 'type:', 'fit:', 'owner:', 'grade:', 'cost_usdc:', 'evidence_hash:',
     'status:', 'reviewed:'].every((k) => fm.includes(k)), fm.slice(0, 120));
  // The invariant. Nothing in this module may ever emit `approved`.
  check('status is always pending', /^status: pending$/m.test(fm));
  check('and the word approved appears nowhere', !/approved/i.test(body));
  check('a null grade is null, not an empty string', /^grade: null$/m.test(fm));
  check('the filename keeps the full host',
    filename === 'mcp-fetcher-example-mcp-2026-09-03.md', filename);
}
{
  const { body } = renderNote(base({
    candidate: { id: 'https://x.test/a', type: 'mcp-server' },
    fit: { verdict: 'fits', owner: 'scheduler', rationale: 'Colons: they break naive YAML.', overlaps: [] },
  }));
  check('a rationale with a colon does not corrupt the frontmatter',
    /^fit: fits$/m.test(body) && /^owner: scheduler$/m.test(body));
}

describe('note: the body says what actually happened');
{
  const b = renderNote(base()).body;
  check('leads with the verdict', /## Verdict\n\n\*\*redundant\*\*/.test(b));
  check('names the overlap in a table', /\| agent \| `researcher` \| holds WebFetch \|/.test(b));
  check('a stopped review says nothing was graded', /a redundant candidate costs nothing/.test(b));
  check('has every required section',
    ['## Verdict', '## Overlap', '## Placement', '## Scorecard', '## Recipe', '## Decision log']
      .every((h) => b.includes(h)));
}
{
  const b = renderNote(base({
    fit: { verdict: 'fits', owner: 'scheduler', rationale: 'New capability.', overlaps: [] },
    grade: { grade: 'A', score: 91.8, model: 'claude-sonnet-5', evidence_sha256: 'abc123',
             layers: { static_pct: 91.8, behavioral_pct: null, guidance_pct: null },
             grade_json: { worst_failure_modes: ['[MEDIUM] no title'] },
             recipe_md: '# Recipe\n\n1. Rule one.' },
    transcripts: 'https://scorecard.test/grade/x/transcripts', stopped_at: 'cached',
  })).body;
  check('an unmeasured layer says so rather than showing 0',
    /behavioural _not measured_/.test(b), b.match(/Static.*/)?.[0]);
  check('the tape is linked', /\[Replay the tape\]/.test(b));
  check('the drafted recipe is inline', /Rule one\./.test(b));
  check('placement warns that scoping is not enforced',
    /recorded, not enforced/.test(b));
}
{
  const b = renderNote(base({
    candidate: { id: 'https://github.com/o/r', type: 'repo' },
    fit: { verdict: 'fits', owner: 'researcher', rationale: 'New.', overlaps: [] },
    scan: { scanned_chars: 900, source: 'README.md', truncated: false, hard: 1, steering: 2,
            hits: [{}], failure_modes: ['injection-shaped content in README.md (secrecy-instruction): "x"'] },
    stopped_at: 'scan',
  })).body;
  // The claim a repo report must never imply.
  check('a repo says behavioural is n/a instead of implying a grade',
    /behavioral grade: n\/a - no tools to probe/.test(b), b.match(/## Scorecard[\s\S]{0,90}/)?.[0]);
  check('it reports what it scanned', /Scanned 900 chars/.test(b));
  check('and reports the split', /1 hard, 2 steering/.test(b));
}
{
  const b = renderNote(base({
    candidate: { id: 'https://github.com/o/r', type: 'repo' },
    fit: { verdict: 'fits', owner: 'researcher', rationale: 'New.', overlaps: [] },
    scan: { scanned_chars: 200000, source: 'README.md', truncated: true, hard: 0, steering: 0,
            hits: [], failure_modes: [] },
    stopped_at: 'scan',
  })).body;
  // A clean result over a clipped document is a claim about text nobody read.
  check('a truncated scan says it was partial', /TRUNCATED, so this is a partial scan/.test(b));
}

describe('note: the one-page cap trims the recipe first');
{
  const longRecipe = '# Recipe\n\n' + Array.from({ length: 60 }, (_, i) => `${i + 1}. Rule ${i + 1}.`).join('\n');
  const r = renderNote(base({
    fit: { verdict: 'fits', owner: 'scheduler', rationale: 'New.', overlaps: [] },
    grade: { grade: 'B', score: 74, model: 'm', layers: {}, recipe_md: longRecipe },
  }));
  const lines = r.body.split('\n').length;
  check('it fits one page', lines <= MAX_NOTE_LINES + 4, String(lines));
  check('it says it trimmed rather than trimming silently',
    /Recipe trimmed to hold one page/.test(r.body));
  check('the verdict survived the trim', /## Verdict/.test(r.body));
  check('the scorecard section survived the trim', /## Scorecard/.test(r.body));
  check('the decision log survived the trim', /## Decision log/.test(r.body));
}

describe('note: it never loses a report');
{
  const dir = mkdtempSync(join(tmpdir(), 'doorman-note-'));
  const vault = join(dir, 'vault'), registry = join(dir, 'registry');

  const ok = writeNote(base(), { vaultPath: vault, registryDir: registry });
  check('writes into the vault when it can', ok.path.includes(join('clembot-doorman', 'reviews')),
    ok.path);
  check('and does not report a fallback', ok.fellBack === false);
  check('the file is really there', readFileSync(ok.path, 'utf8').includes('status: pending'));

  // Vault unwritable: the report must survive anyway.
  const brokenFs = {
    existsSync,
    mkdirSync: (d, o) => { if (String(d).includes('vault')) throw new Error('EACCES'); return realMkdir(d, o); },
    writeFileSync: realWrite,
  };
  const fell = writeNote(base(), { vaultPath: vault, registryDir: registry, fs: brokenFs });
  check('falls back to the registry when the vault is unwritable',
    fell.path.includes('registry'), fell.path);
  check('and warns rather than going quiet', /falling back to the registry/.test(fell.warning || ''),
    String(fell.warning));

  let threw = null;
  try { writeNote(base(), {}); } catch (e) { threw = e; }
  check('with nowhere to write at all it throws instead of dropping the report',
    threw !== null, String(threw));

  rmSync(dir, { recursive: true, force: true });
}

describe('note: the decision log is append-only');
{
  const dir = mkdtempSync(join(tmpdir(), 'doorman-log-'));
  const w = writeNote(base(), { registryDir: dir });
  const before = readFileSync(w.path, 'utf8');
  const res = appendDecision(w.path, '2026-09-04 · approved by hand');
  const after = readFileSync(w.path, 'utf8');
  check('the append succeeds', res.appended === true, JSON.stringify(res));
  check('the new line is there', after.includes('approved by hand'));
  check('and nothing before it changed', after.startsWith(before), 'prefix changed');

  const missing = appendDecision(w.path.replace(/\.md$/, '-nolog.md'), 'x', {
    fs: { readFileSync: () => '# a note with no log section', appendFileSync: () => {
      throw new Error('must not append to a note without a log');
    } },
  });
  check('a note with no log section is left alone and reported',
    missing.appended === false && /no "## Decision log"/.test(missing.reason), JSON.stringify(missing));
  rmSync(dir, { recursive: true, force: true });
}

import { existsSync, mkdirSync as realMkdir, writeFileSync as realWrite } from 'node:fs';
