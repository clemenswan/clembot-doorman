/**
 * Turning an approved note into a registry entry.
 *
 * Split out of the poller so it can be tested without a filesystem, a clock or
 * a network. The poller reads notes and writes files; this decides what should
 * happen, and decides nothing else.
 *
 * ── The rule that outranks the human ─────────────────────────────────────────
 *
 * A hard-failed server is refused even when the note says `approved`. Not
 * because the human is wrong, but because "approved" on a note and "safe to put
 * in the file the gate reads" are different claims, and a hard fail means the
 * server was caught doing the one thing that disqualifies it outright. The
 * refusal is written back into the note's decision log so it is visible where
 * the decision was made, not buried in a terminal.
 */

import { parseFrontmatter } from './inventory.mjs';

export const APPROVED = 'approved';
export const DENIED = 'denied';
export const PENDING = 'pending';

/**
 * Decide what a single note should cause.
 *
 * @param {object} note   { path, frontmatter }
 * @param {object} registry { allow: {servers}, deny: {servers} }
 * @returns {{ action, key, reason, entry? }}
 *   action: 'allow' | 'deny' | 'refuse' | 'skip'
 */
export function decideForNote(note, registry = {}) {
  const fm = note.frontmatter ?? {};
  const status = (fm.status ?? '').trim();
  const candidate = fm.candidate;
  const key = fm.owner && fm.owner !== 'null' ? fm.owner : null;

  if (status === PENDING || status === '') {
    return { action: 'skip', reason: 'still pending; a human has not decided' };
  }
  if (status === DENIED) {
    return {
      action: 'deny',
      key: fm.mcp_name ?? null,
      candidate,
      reason: 'denied by hand in the note',
      entry: baseEntry(fm),
    };
  }
  if (status !== APPROVED) {
    return { action: 'skip', reason: `unrecognised status "${status}"; refusing to guess` };
  }

  if (fm.type && fm.type !== 'mcp-server') {
    return {
      action: 'skip',
      reason: `type "${fm.type}" is not an MCP server, so it has no place in the gate's registry`,
    };
  }

  // The refusal. Deliberately AFTER the approval check, so the log line records
  // that a human said yes and the rule said no.
  const grade = fm.grade;
  const hardFail = fm.hard_fail && fm.hard_fail !== 'null' ? fm.hard_fail : null;
  if (grade === 'F' || hardFail) {
    return {
      action: 'refuse',
      candidate,
      reason: hardFail
        ? `approved by hand, but REFUSED: hard fail (${hardFail})`
        : 'approved by hand, but REFUSED: grade F',
      entry: baseEntry(fm),
    };
  }

  if (!grade || grade === 'null') {
    return {
      action: 'refuse',
      candidate,
      reason: 'approved by hand, but REFUSED: there is no grade on this note',
    };
  }

  const already = (registry.allow?.servers ?? {})[fm.mcp_name ?? ''];
  if (already && already.audit_id === fm.audit_id) {
    return { action: 'skip', reason: 'already allowlisted from this same audit' };
  }

  return {
    action: 'allow',
    key: fm.mcp_name ?? null,
    candidate,
    assigned_to: key,
    reason: `approved by hand, grade ${grade}`,
    entry: baseEntry(fm),
  };
}

function baseEntry(fm) {
  return {
    decision: 'allow',
    url: fm.candidate ?? null,
    grade: fm.grade === 'null' ? null : (fm.grade ?? null),
    audit_id: fm.audit_id ?? null,
    evidence_sha256: fm.evidence_hash === 'null' ? null : (fm.evidence_hash ?? null),
    /* `assigned_to`, NOT `owner`. The poller already uses `owner` for the
       scorecard allowlist tenant, and one word meaning two things in one file
       is how a scoping rule quietly stops meaning anything. */
    assigned_to: fm.owner === 'null' ? null : (fm.owner ?? null),
    graded_at: fm.reviewed ?? null,
    note: 'Approved by hand from a review note. Scoping is recorded, not enforced: ' +
          'the gate cannot tell which subagent is calling.',
  };
}

/** Read a note file's frontmatter into the shape decideForNote wants. */
export function readNote(path, text) {
  const fm = parseFrontmatter(text);
  return { path, frontmatter: fm ?? {}, readable: Boolean(fm) };
}
