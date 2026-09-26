/**
 * The three dashboard views, as HTML fragments.
 *
 * ── No script tag ────────────────────────────────────────────────────────────
 *
 * `dashboard.mjs` promises "no server, no port, no CDN, no script tag, no
 * dependency", and that promise is why this page works in a locked-down room
 * with no egress, which is the room the demo happens in. So the tabs are radio
 * inputs and sibling selectors, and the radar is inline SVG. Neither needs a
 * line of JavaScript.
 *
 * ── Three views, and no fourth ───────────────────────────────────────────────
 *
 *   My report      the seven dimensions, every check, every receipt.
 *   vs reference   the same seven overlaid with a bundled profile, gaps first.
 *   authority      pattern cards for the FAILED checks only.
 *
 * The third one is filtered to failures on purpose. A feed of advice about
 * things already passing is the shape of a tool that pads its output to look
 * busy, and it buries the two lines somebody is meant to act on.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const MARK = { pass: '&#10003;', warn: '&#9651;', fail: '&#10007;', 'n/a': '&ndash;' };
const CLS = { pass: 'pass', warn: 'warn', fail: 'fail', 'n/a': 'na' };

/* ── radar ─────────────────────────────────────────────────────────────────── */

const SIZE = 260;
const R = 96;
const CX = SIZE / 2;
const CY = SIZE / 2 + 6;

function point(i, n, frac) {
  // Start at twelve o'clock and go clockwise, which is how every reader
  // expects to trace one.
  const a = (Math.PI * 2 * i) / n - Math.PI / 2;
  return [CX + Math.cos(a) * R * frac, CY + Math.sin(a) * R * frac];
}

function polygon(values, cls) {
  const pts = values.map((v, i) => point(i, values.length, v))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<polygon class="${cls}" points="${pts}" />`;
}

/**
 * A dimension with nothing to measure plots at ZERO and is labelled n/a.
 *
 * Plotting it at full would draw a build as complete on a dimension nobody
 * measured, which is invariant 3 with a shape instead of a number. Plotting it
 * at zero and saying so in the label is the honest pair.
 */
const fracOf = (d) => (d.pct === null ? 0 : d.pct / 100);

export function radar(report, reference = null) {
  const dims = report.dimensions;
  const n = dims.length;
  const rings = [0.25, 0.5, 0.75, 1].map((f) =>
    `<polygon class="ring" points="${dims.map((_, i) => point(i, n, f))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" />`).join('');
  const spokes = dims.map((_, i) => {
    const [x, y] = point(i, n, 1);
    return `<line class="spoke" x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`;
  }).join('');
  const labels = dims.map((d, i) => {
    const [x, y] = point(i, n, 1.17);
    const anchor = x < CX - 6 ? 'end' : x > CX + 6 ? 'start' : 'middle';
    return `<text class="lbl" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">`
      + `${esc(String(d.id))}<tspan class="lblband"> ${esc(d.letter ?? 'n/a')}</tspan></text>`;
  }).join('');

  const refPoly = reference
    ? polygon(alignDimensions(reference, dims).map(fracOf), 'ref')
    : '';

  return `<svg class="radar" viewBox="0 0 ${SIZE} ${SIZE + 18}" role="img"
    aria-label="Seven dimension scores">
    ${rings}${spokes}${refPoly}${polygon(dims.map(fracOf), 'mine')}${labels}
  </svg>`;
}

/**
 * Line a reference profile up with this report's dimensions BY KEY.
 *
 * Not by array index. A reference generated before a dimension was added
 * would otherwise silently shift every comparison by one, and the gap list is
 * the slide somebody makes a decision from.
 */
export function alignDimensions(reference, dims) {
  const byKey = new Map((reference.dimensions ?? []).map((d) => [d.key, d]));
  return dims.map((d) => byKey.get(d.key) ?? { key: d.key, pct: null, letter: null, checks: [] });
}

/* ── view 1: my report ─────────────────────────────────────────────────────── */

function checkRow(c) {
  return `<tr class="s-${CLS[c.state]}">
    <td class="mark">${MARK[c.state]}</td>
    <td><code>${esc(c.id)}</code> ${esc(c.title)}
      ${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}</td>
    <td class="num">${c.state === 'n/a' ? '<span class="muted">skipped</span>' : `${c.points}/${c.max}`}</td>
    <td class="ev"><code>${esc(c.receipt ?? 'absent')}</code></td>
  </tr>`;
}

export function myReportView(report) {
  const dims = report.dimensions.map((d) => `
    <h4>${esc(String(d.id))}. ${esc(d.title)}
      <span class="muted">${d.letter ?? 'n/a'} &middot; ${d.measured ? `${d.earned}/${d.possible}` : 'not measured'}</span>
    </h4>
    <table class="checks"><tbody>${d.checks.map(checkRow).join('')}</tbody></table>`).join('');

  return `<div class="pv">
    <div class="pv-head">
      <div class="grade"><span class="letter g-${esc(report.letter)}">${esc(report.letter)}</span>
        <span class="score">${report.earned} / ${report.possible}
          <span class="muted">(${report.pct}%, average band ${esc(report.average_letter)})</span></span></div>
      ${radar(report)}
    </div>
    <p class="fine">The letter is the <strong>worst dimension</strong>, not the average. A harness is
    as mature as its weakest gate, so one failing dimension caps the whole report. Both numbers are
    shown so the rule is visible rather than surprising. Skipped checks are out of the denominator,
    never scored zero.</p>
    ${dims}
  </div>`;
}

/* ── view 2: vs reference ──────────────────────────────────────────────────── */

export function vsReferenceView(report, reference, gaps) {
  if (!reference) {
    return `<div class="pv"><p class="muted">No reference profile loaded. Run with
      <code>--reference clembot</code> to compare against the bundled one.</p></div>`;
  }
  const aligned = alignDimensions(reference, report.dimensions);
  const rows = report.dimensions.map((d, i) => {
    const r = aligned[i];
    const delta = d.pct === null || r.pct === null ? null : d.pct - r.pct;
    const cls = delta === null ? 'na' : delta < 0 ? 'fail' : 'pass';
    return `<tr class="s-${cls}">
      <td>${esc(d.title)}</td>
      <td class="num">${d.pct === null ? '<span class="muted">n/a</span>' : `${d.pct}%`}</td>
      <td class="num">${r.pct === null ? '<span class="muted">n/a</span>' : `${r.pct}%`}</td>
      <td class="num">${delta === null ? '<span class="muted">&ndash;</span>' : (delta > 0 ? '+' : '') + delta}</td>
    </tr>`;
  }).join('');

  const gapRows = gaps.length
    ? gaps.map((g) => `<tr>
        <td><code>${esc(g.check.id)}</code> ${esc(g.card?.title ?? g.check.title)}</td>
        <td>${esc(g.dimension.title)}</td>
        <td class="num">${esc(g.effort)}</td>
        <td class="ev"><code>${esc(g.check.receipt ?? 'absent')}</code></td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="muted">No gaps against this reference.</td></tr>';

  return `<div class="pv">
    <div class="pv-head">${radar(report, reference)}
      <div class="legend">
        <span><i class="sw mine"></i> this repo</span>
        <span><i class="sw ref"></i> ${esc(reference.slug ?? 'reference')}</span>
      </div>
    </div>
    <table class="checks"><thead><tr><th>Dimension</th><th class="num">Mine</th>
      <th class="num">Reference</th><th class="num">Delta</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <h4>Gaps, cheapest first</h4>
    <p class="fine">Ordered by gap size divided by effort, so a large gap that is cheap to close
    sorts above a large one that is expensive. That is the order somebody planning a first
    milestone actually wants, not the order of worst score.</p>
    <table class="checks"><thead><tr><th>Check</th><th>Dimension</th><th class="num">Effort</th>
      <th>Receipt</th></tr></thead><tbody>${gapRows}</tbody></table>
  </div>`;
}

/* ── view 3: authority feed ────────────────────────────────────────────────── */

export function authorityView(report, cards, { source = 'bundled', note = null } = {}) {
  const failed = report.dimensions.flatMap((d) => d.checks)
    .filter((c) => c.state === 'fail' || c.state === 'warn');
  const byId = new Map(cards.map((c) => [c.id, c]));

  const banner = source === 'bundled'
    ? `<p class="offline">Offline snapshot. These cards are the copy bundled with the plugin, not a
       live read of the authority.${note ? ` ${esc(note)}` : ''} The same files seed the authority,
       so the two cannot disagree about what a card says.</p>`
    : '<p class="fine">Live from the authority.</p>';

  if (!failed.length) {
    return `<div class="pv">${banner}<p class="muted">Nothing failed, so there is nothing to
      advise on. Cards are shown for open checks only.</p></div>`;
  }

  const cardsHtml = failed.map((c) => {
    const card = byId.get(c.id);
    if (!card) {
      return `<article class="card"><h4><code>${esc(c.id)}</code></h4>
        <p class="muted">No pattern card is published for this check yet.</p></article>`;
    }
    const mcps = card.graded_mcps?.length
      ? `<p class="fine"><strong>Graded tools that help:</strong>
         ${card.graded_mcps.map((m) => `<code>${esc(m)}</code>`).join(', ')}</p>`
      : '';
    return `<article class="card">
      <h4>${esc(card.title)} <span class="muted">${esc(card.effort)} &middot; <code>${esc(card.id)}</code></span></h4>
      <p><strong>Why.</strong> ${esc(card.why)}</p>
      <p><strong>Fix.</strong> ${esc(card.fix)}</p>
      <p class="fine"><strong>Here:</strong> <code>${esc(c.receipt ?? 'absent')}</code>
        ${c.note ? `&middot; ${esc(c.note)}` : ''}</p>
      ${mcps}
      ${card.evidence_url ? `<p class="fine"><a href="${esc(card.evidence_url)}">evidence</a></p>` : ''}
    </article>`;
  }).join('');

  return `<div class="pv">${banner}
    <p class="fine">Shown for the ${failed.length} open check(s) only. Advice about things already
    passing pads the page and buries what to act on.</p>
    ${cardsHtml}
    <p class="fine">Selecting packages for a statement of work is
    <code>doorman profile --sow</code>, which writes the document from these same cards. The
    dashboard does not hold state: a page that remembered toggles would be a page with a database.</p>
  </div>`;
}

/* ── the section, with CSS-only tabs ───────────────────────────────────────── */

export function profileSection(report, { reference = null, cards = [], gaps = [], source, note } = {}) {
  if (!report) return '';
  return `
  <section class="profile">
    <h2>Harness profile <span class="muted">${esc(report.slug)}</span></h2>
    <div class="tabs">
      <input type="radio" name="pvtab" id="pvtab-mine" checked>
      <label for="pvtab-mine">My report</label>
      <input type="radio" name="pvtab" id="pvtab-ref">
      <label for="pvtab-ref">vs reference</label>
      <input type="radio" name="pvtab" id="pvtab-auth">
      <label for="pvtab-auth">Authority feed</label>
      <div class="panes">
        <div class="pane pane-mine">${myReportView(report)}</div>
        <div class="pane pane-ref">${vsReferenceView(report, reference, gaps)}</div>
        <div class="pane pane-auth">${authorityView(report, cards, { source, note })}</div>
      </div>
    </div>
  </section>`;
}

/** Styles for the section. Appended to the page's own block; no CDN, no font fetch. */
export const PROFILE_CSS = `
.profile .tabs{margin-top:8px}
.profile .tabs>input{position:absolute;opacity:0;pointer-events:none}
.profile .tabs>label{display:inline-block;padding:7px 13px;margin:0 4px 0 0;cursor:pointer;
  border:1px solid var(--line);border-bottom:none;font-size:13px;background:transparent}
.profile .tabs>input:checked+label{font-weight:600;border-bottom:2px solid var(--fg)}
.profile .tabs>input:focus-visible+label{outline:2px solid var(--fg);outline-offset:2px}
.profile .panes{border-top:1px solid var(--line);padding-top:14px}
.profile .pane{display:none}
#pvtab-mine:checked~.panes .pane-mine,
#pvtab-ref:checked~.panes .pane-ref,
#pvtab-auth:checked~.panes .pane-auth{display:block}
.pv-head{display:flex;gap:26px;align-items:center;flex-wrap:wrap}
.radar{width:260px;height:278px;flex:0 0 auto}
.radar .ring,.radar .spoke{fill:none;stroke:var(--line);stroke-width:1}
.radar .mine{fill:color-mix(in srgb,var(--green) 18%,transparent);stroke:var(--green);stroke-width:2}
.radar .ref{fill:none;stroke:var(--muted);stroke-width:1.5;stroke-dasharray:4 3}
.radar .lbl{font-size:10px;fill:var(--muted)}
.radar .lblband{font-weight:600;fill:var(--fg)}
.legend{font-size:12px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap}
.legend .sw{display:inline-block;width:14px;height:0;border-top:2px solid var(--green);
  vertical-align:middle;margin-right:5px}
.legend .sw.ref{border-top:2px dashed var(--muted)}
.profile .card{border:1px solid var(--line);padding:13px 15px;margin:12px 0}
.profile .card h4{margin:0 0 7px}
.profile .card p{margin:6px 0}
.profile .offline{border:1px solid var(--line);border-left:3px solid var(--warn);
  padding:9px 12px;font-size:13px;margin:0 0 12px}
@media (max-width:560px){.pv-head{gap:14px}.radar{width:100%;max-width:300px;height:auto}}
`;
