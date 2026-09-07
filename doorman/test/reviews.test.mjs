/**
 * Approved notes to registry entries.
 *
 * The assertion that matters: a hard-failed server is refused even when a human
 * approved it, and the refusal lands in the note's own decision log rather than
 * only in a terminal nobody kept.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import { APPROVED, decideForNote, readNote } from '../src/reviews.mjs';
import { appendDecision, writeNote } from '../src/note.mjs';

const note = (fm) => ({ path: '/x.md', frontmatter: fm });

const good = {
  candidate: 'https://mcp.calendar.example/mcp', type: 'mcp-server', fit: 'fits',
  owner: 'scheduler', grade: 'A', status: APPROVED, reviewed: '2026-09-03',
  audit_id: 'aud_1', evidence_hash: 'abc', mcp_name: 'calendar',
};

describe('reviews: nothing happens until a human decides');
{
  check('pending is skipped',
    decideForNote(note({ ...good, status: 'pending' })).action === 'skip');
  check('an empty status is skipped',
    decideForNote(note({ ...good, status: '' })).action === 'skip');
  check('an unrecognised status is skipped rather than guessed',
    decideForNote(note({ ...good, status: 'maybe' })).action === 'skip');
  check('the skip says why', /refusing to guess/.test(
    decideForNote(note({ ...good, status: 'maybe' })).reason));
}

describe('reviews: the hard-fail refusal outranks the approval');
{
  const f = decideForNote(note({ ...good, grade: 'F' }));
  check('an F is refused even when approved', f.action === 'refuse', f.action);
  check('and the reason records that a human said yes',
    /approved by hand, but REFUSED/.test(f.reason), f.reason);

  const hf = decideForNote(note({
    ...good, grade: 'B', hard_fail: 'injection-shaped content in 1 location(s)',
  }));
  check('a hard fail on a passing grade is still refused', hf.action === 'refuse', hf.action);
  check('the refusal quotes the hard fail', /injection-shaped/.test(hf.reason), hf.reason);

  const none = decideForNote(note({ ...good, grade: 'null' }));
  check('approved with no grade at all is refused', none.action === 'refuse', none.reason);

  // The failure this prevents: refusing everything, which would look identical
  // in a suite that only tested the refusals.
  const ok = decideForNote(note(good));
  check('a clean approval is NOT refused', ok.action === 'allow', ok.action);
}

describe('reviews: what an allowed entry carries');
{
  const d = decideForNote(note(good));
  check('it is keyed by the MCP client name, not the hostname',
    d.key === 'calendar', String(d.key));
  check('the target subagent is assigned_to, not owner',
    d.entry.assigned_to === 'scheduler' && d.entry.owner === undefined,
    JSON.stringify(d.entry));
  check('the audit id and hash come across',
    d.entry.audit_id === 'aud_1' && d.entry.evidence_sha256 === 'abc');
  check('the entry states that scoping is not enforced',
    /recorded, not enforced/.test(d.entry.note));
}
{
  const dup = decideForNote(note(good), {
    allow: { servers: { calendar: { audit_id: 'aud_1' } } },
  });
  check('the same audit twice is a skip, so it is idempotent',
    dup.action === 'skip', dup.action);
  const regraded = decideForNote(note({ ...good, audit_id: 'aud_2' }), {
    allow: { servers: { calendar: { audit_id: 'aud_1' } } },
  });
  check('a NEW audit for the same server is applied', regraded.action === 'allow');
}

describe('reviews: only MCP servers reach the gate registry');
{
  for (const t of ['repo', 'skill']) {
    const d = decideForNote(note({ ...good, type: t }));
    check(`an approved ${t} is not written to the registry`, d.action === 'skip', d.action);
    check(`and it says why for ${t}`, /no place in the gate/.test(d.reason));
  }
}

describe('reviews: denial');
{
  const d = decideForNote(note({ ...good, status: 'denied' }));
  check('a denied note produces a deny', d.action === 'deny', d.action);
}

describe('reviews: end to end against a real note on disk');
{
  const dir = mkdtempSync(join(tmpdir(), 'doorman-rev-'));
  const w = writeNote({
    candidate: { id: 'https://webzum.example/api/mcp', type: 'mcp-server' },
    reviewed: '2026-09-03',
    fit: { verdict: 'fits', owner: 'researcher', rationale: 'New capability.', overlaps: [] },
    grade: { grade: 'F', score: 49, model: 'm', layers: {}, evidence_sha256: 'deadbeef',
             hard_fail: 'injection-shaped content in 1 location(s)' },
    cost_usdc: 0, audit_id: 'aud_f', transcripts: 'https://s.test/t',
  }, { registryDir: dir });

  const text = readFileSync(w.path, 'utf8');
  const parsed = readNote(w.path, text);
  check('the written note parses back', parsed.readable === true);
  check('and it is pending, as written', parsed.frontmatter.status === 'pending');

  // Simulate the human flipping it.
  const flipped = text.replace('status: pending', 'status: approved');
  const approvedNote = readNote(w.path, flipped);
  approvedNote.frontmatter.hard_fail = 'injection-shaped content in 1 location(s)';
  const d = decideForNote(approvedNote);
  check('a hand-approved F is refused end to end', d.action === 'refuse', d.action);

  const logged = appendDecision(w.path, `2026-09-04 · ${d.reason}`);
  check('the refusal is appended to the note itself', logged.appended === true);
  check('and it is readable there',
    /REFUSED/.test(readFileSync(w.path, 'utf8')), 'refusal not in note');
  rmSync(dir, { recursive: true, force: true });
}
