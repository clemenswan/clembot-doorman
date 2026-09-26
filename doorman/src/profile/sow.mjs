/**
 * A statement of work, derived from failed checks and nothing else.
 *
 * ── Every sentence traces to a check id ──────────────────────────────────────
 *
 * The rule that keeps this honest: no adjective a check does not back. There
 * is no "significant", no "best-in-class", no "we observed a mature setup".
 * Each work package names the check it closes, the receipt that proved it
 * open, and an acceptance criterion that is literally re-running the tool.
 *
 * That makes the document checkable by the person receiving it, which is
 * unusual for a proposal and is the entire reason to generate one from a
 * measurement rather than write it by hand.
 *
 * ── Commercial terms are slots ───────────────────────────────────────────────
 *
 * Rate, duration, engagement model and milestones are left as {{slots}} on
 * purpose. A generator that invented a day rate would be inventing the one
 * number in the document nobody can check against the repo.
 *
 * Acceptance criteria are NOT slots. They derive from check ids, which is the
 * part of this document that is actually earned.
 */

export const COMMERCIAL_SLOTS = ['engagement_model', 'rate', 'duration', 'milestones'];

const EFFORT_WEIGHT = { S: 1, M: 3, L: 8 };

/** Gap size times cost to close. The ordering the first slide needs. */
export function rankGaps(report, cards, reference = null) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const refCheck = new Map();
  if (reference) {
    for (const d of reference.dimensions || []) {
      for (const c of d.checks || []) refCheck.set(c.id, c);
    }
  }

  const out = [];
  for (const d of report.dimensions) {
    for (const c of d.checks) {
      if (c.state === 'pass' || c.state === 'n/a') continue;
      const card = byId.get(c.id) ?? null;
      const mine = c.max ? c.points / c.max : 0;
      const ref = refCheck.get(c.id);
      // Against a reference, the gap is what THEY have and you do not. With no
      // reference it is simply what you are missing against a full score, and
      // the report says which of the two it used rather than implying one.
      const theirs = ref && ref.max ? ref.points / ref.max : 1;
      const gap = Math.max(0, theirs - mine);
      const weight = EFFORT_WEIGHT[card?.effort ?? 'M'] ?? 3;
      out.push({
        check: c, card, dimension: d,
        gap, effort: card?.effort ?? 'M',
        // Divided, not multiplied. A large gap that is cheap to close should
        // sort above a large gap that is expensive, which is what somebody
        // planning a first milestone actually wants.
        score: gap / weight,
        comparedTo: ref ? 'reference' : 'full-marks',
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.check.id.localeCompare(b.check.id));
}

export function renderSow(report, cards, { reference = null, selected = null, profile = null } = {}) {
  let gaps = rankGaps(report, cards, reference);
  if (selected && selected.length) {
    const want = new Set(selected);
    gaps = gaps.filter((g) => want.has(g.check.id));
  }

  const L = [];
  L.push(`# Statement of work: ${report.slug}`);
  L.push('');
  L.push('## Context');
  L.push('');
  const failing = report.dimensions.filter((d) => d.letter && d.letter !== 'A');
  L.push(
    `The harness scores ${report.earned} of ${report.possible} points (${report.pct}%) across ` +
    `${report.dimensions.filter((d) => d.measured).length} measured dimensions, banding ${report.letter} ` +
    `overall because the overall band is the weakest dimension rather than the average ` +
    `(average ${report.average_letter}). ` +
    (failing.length
      ? `${failing.length} dimension(s) score below A: ${failing.map((d) => `${d.title} (${d.letter})`).join(', ')}. `
      : 'No dimension scores below A. ') +
    `${gaps.length} check(s) are open. ` +
    (reference
      ? 'Gaps are measured against the supplied reference profile.'
      : 'Gaps are measured against full marks, since no reference profile was supplied.'),
  );
  L.push('');

  L.push('## Work packages');
  L.push('');
  if (!gaps.length) {
    L.push('None. Every measured check passes, so there is no work to propose that the');
    L.push('report would support.');
    L.push('');
  }

  const byDim = new Map();
  for (const g of gaps) {
    if (!byDim.has(g.dimension.id)) byDim.set(g.dimension.id, []);
    byDim.get(g.dimension.id).push(g);
  }

  let n = 0;
  for (const [, group] of [...byDim.entries()].sort((a, b) => a[0] - b[0])) {
    L.push(`### ${group[0].dimension.title}`);
    L.push('');
    for (const g of group) {
      n++;
      const c = g.check;
      L.push(`#### WP${String(n).padStart(2, '0')}. ${g.card?.title ?? c.title}`);
      L.push('');
      L.push(`- **Check**: \`${c.id}\` (currently ${c.state.toUpperCase()}, ` +
        `${c.state === 'n/a' ? 'not measured' : `${c.points}/${c.max}`})`);
      L.push(`- **Evidence**: \`${c.receipt ?? 'absent'}\``);
      if (c.note) L.push(`- **Observed**: ${c.note}`);
      if (g.card) {
        L.push(`- **Why it matters**: ${g.card.why}`);
        L.push(`- **What changes**: ${g.card.fix}`);
        if (g.card.graded_mcps?.length) {
          L.push(`- **Graded tools that help**: ${g.card.graded_mcps.join(', ')}`);
        }
      } else {
        L.push('- **Why it matters**: no pattern card is published for this check yet.');
      }
      L.push(`- **Effort**: ${g.effort}`);
      L.push(`- **Acceptance**: \`doorman profile\` re-run on this repo reports \`${c.id}\` as PASS.`);
      L.push('');
    }
  }

  L.push('## Verification');
  L.push('');
  L.push('Acceptance is not a judgement call. At each milestone the client re-runs');
  L.push('`doorman profile` on their own machine, and the report is the acceptance');
  L.push('artifact: a package is done when its check reports PASS and not before.');
  L.push('');
  L.push('The tool reads the harness surface only and writes its report locally, so');
  L.push('verification needs no access granted to anyone and nothing leaves the repo.');
  L.push('');

  L.push('## Commercial');
  L.push('');
  for (const s of COMMERCIAL_SLOTS) {
    L.push(`- **${s.replace(/_/g, ' ')}**: {{${s}}}`);
  }
  L.push('');
  L.push('These are the only unfilled fields in this document. Every other line above');
  L.push('traces to a check id in the appended profile.');
  L.push('');

  L.push('## Appendix: exported profile');
  L.push('');
  if (profile) {
    if (!profile.complete) {
      L.push(`This profile is **redacted**: ${profile.redacted_count} value(s) were dropped ` +
        `by rules ${profile.redacted_rules.join(', ')}. It is visibly not a full profile, ` +
        'which is deliberate, so nothing here is compared against a complete one as though it were.');
      L.push('');
    }
    L.push('```json');
    L.push(JSON.stringify(profile, null, 2));
    L.push('```');
  } else {
    L.push('Not exported. Run `doorman profile --export` to attach the structure-only profile.');
  }
  L.push('');
  return L.join('\n');
}
