/**
 * Reviewing the tool surface of a server doorman cannot connect to.
 *
 * Most servers a real build reaches are behind a login, and the claude.ai
 * connectors have no local url at all. doorman could see their names and
 * nothing else, which left the one thing it exists to check unchecked: the
 * descriptions an agent reads as instructions before choosing a tool. That is
 * where WebZum hid 6,290 characters telling the reading agent to upsell and
 * steer users off named competitors.
 *
 * So a surface can arrive as a CAPTURE: a JSON file listing the tools as some
 * agent session saw them. Then the same scanner used everywhere else runs over
 * it.
 *
 * THE RULE THAT HOLDS THIS UP: a capture is not a connection.
 *
 *   - It is transcribed by an agent from schemas its own session loaded, so it
 *     can be stale, partial, or wrong in a way a fetch could not be.
 *   - `provenance` is mandatory. A capture that cannot say where it came from
 *     is refused, not scored, because an unsourced tool list is indistinguish-
 *     able from one somebody typed.
 *   - It NEVER produces a band or a score. `status` is `surface-reviewed`, and
 *     a reader must not be able to mistake it for a graded audit. Invariant 9,
 *     pointed at the one input doorman does not fetch itself.
 *
 * A finding here is still a real finding: the text an agent reads is hostile or
 * it is not, whoever copied it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { scanText } from './injection.mjs';

const SURFACES = path.join('.doorman', 'surfaces');

/** Every schema field description an agent is shown, flattened with its path. */
function schemaTexts(schema, trail = []) {
  if (!schema || typeof schema !== 'object') return [];
  const out = [];
  if (typeof schema.description === 'string' && trail.length) out.push({ trail: trail.join('.'), text: schema.description });
  for (const [k, v] of Object.entries(schema.properties || {})) out.push(...schemaTexts(v, [...trail, k]));
  if (schema.items) out.push(...schemaTexts(schema.items, [...trail, '[]']));
  return out;
}

export function reviewSurface(capture) {
  if (!capture || typeof capture !== 'object') return { status: 'invalid', why: 'not an object' };
  if (typeof capture.provenance !== 'string' || !capture.provenance.trim()) {
    return { status: 'invalid', why: 'a capture must carry provenance: where the tool list came from, and that it was not fetched' };
  }
  const tools = Array.isArray(capture.tools) ? capture.tools : [];
  const instructions = typeof capture.instructions === 'string' ? capture.instructions : null;
  if (!tools.length && !instructions) {
    return { status: 'invalid', why: 'nothing in the capture: an empty surface is unknown, not clean' };
  }

  const hits = [];
  let scanned_chars = 0;

  // Server-level instructions reach the agent BEFORE it picks a tool, which
  // makes them the most privileged text a server sends. Scanning only tool
  // descriptions would miss them.
  if (instructions) {
    scanned_chars += instructions.length;
    hits.push(...scanText(instructions, 'server instructions'));
  }
  for (const t of tools) {
    const name = t?.name || '(unnamed)';
    for (const [text, where] of [
      [t?.description, `tool ${name} description`],
      [t?.title, `tool ${name} title`],
    ]) {
      if (typeof text === 'string') { scanned_chars += text.length; hits.push(...scanText(text, where)); }
    }
    for (const f of schemaTexts(t?.inputSchema)) {
      scanned_chars += f.text.length;
      hits.push(...scanText(f.text, `tool ${name} schema ${f.trail} description`));
    }
  }

  const hard = hits.filter((h) => h.severity === 'hard').length;
  const steering = hits.filter((h) => h.severity === 'steering').length;
  // Reported, never scored. A surface review has no score to move anyway, but
  // it must still SHOW the finding: the advisory class exists because a polite
  // upsell was invisible, and a counter that ignores it rebuilds that blind spot.
  const advisory = hits.filter((h) => h.severity === 'advisory').length;
  return {
    status: 'surface-reviewed',
    server: capture.server ?? null,
    gate_name: capture.gate_name ?? null,
    captured_at: capture.captured_at ?? null,
    provenance: capture.provenance,
    tools_scanned: tools.length,
    instructions_scanned: Boolean(instructions),
    scanned_chars,
    hits, hard, steering, advisory,
    failure_modes: [
      ...hits.filter((h) => h.severity === 'hard').map((h) => `injection-shaped content in ${h.location} (${h.pattern}): "${h.excerpt}"`),
      ...hits.filter((h) => h.severity === 'steering').map((h) => `commercial steering in ${h.location} (${h.pattern}): "${h.excerpt}"`),
      ...hits.filter((h) => h.severity === 'advisory').map((h) => `commercial promotion (advisory, not scored) in ${h.location} (${h.pattern}): "${h.excerpt}"`),
    ],
    hard_fail: hard ? `injection-shaped content in ${hard} location(s) of the captured surface` : null,
  };
}

/** Captures on disk, keyed by gate name. Unreadable files are listed, never dropped. */
export function readSurfaces(root, dir = SURFACES) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return {};
  const out = {};
  const unreadable = [];
  for (const f of readdirSync(abs).filter((n) => n.endsWith('.json'))) {
    try {
      const j = JSON.parse(readFileSync(path.join(abs, f), 'utf8'));
      out[j.gate_name || path.basename(f, '.json')] = j;
    } catch { unreadable.push(f); }
  }
  if (unreadable.length) out.__unreadable = unreadable;
  return out;
}
