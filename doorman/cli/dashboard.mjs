/**
 * `doorman dashboard` — the audit, as a page you can actually read.
 *
 * It measures nothing of its own. `auditProject()` already runs doctor, needs
 * and watch and synthesises them; this renders that result and grades the
 * doctor half. A second inspection path would be invariant 2 applied to an
 * inspection instead of to grade math: two reads of the same config that can
 * disagree, and on the day they do, the one you believed is whichever you
 * happened to run.
 *
 * The page is one self-contained HTML file. No server, no port, no CDN, no
 * script tag, no dependency. `doorman dashboard` writes it and opens it, and
 * that is the entire lifecycle. A server would need a port, a shutdown, and a
 * reason, and refreshing a page is not a reason.
 *
 * WHAT IT WRITES, and nothing else:
 *   .doorman/report.html          the page
 *   .doorman/runs/<date>.json     a small snapshot, so the next run can diff
 *
 * The snapshot is what makes this a newsletter rather than a status readout.
 * Week two says "the gate went from inert to wired, two gaps closed, one
 * opened", and that sentence cannot be produced from a single run. Same-day
 * reruns overwrite: a day is the unit, not an invocation.
 *
 * There is no scheduler here on purpose. The OS already has one, and a cron
 * line in a README is a smaller thing to maintain than a daemon.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { auditProject } from './audit.mjs';
import { gradeBuild } from '../src/harness-grade.mjs';
import { readReviews } from './review.mjs';
import { readSurfaces, reviewSurface } from '../src/surface.mjs';

const OUT_DIR = '.doorman';

/** Local calendar day. A UTC date would roll the newsletter over at dinner. */
function dayStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Everything a later run needs to say what changed. Deliberately small. */
function snapshotOf(res, grade) {
  return {
    day: dayStamp(),
    timestamp: res.timestamp,
    root: res.root,
    letter: grade.letter,
    pct: grade.pct,
    earned: grade.earned,
    possible: grade.possible,
    checks: grade.checks.map((c) => ({ id: c.id, state: c.state, points: c.points, max: c.max })),
    gaps: (res.needs?.gaps || []).map((g) => g.title || g.id).filter(Boolean),
    servers: (res.doctor?.servers || []).map((s) => s.gateName ?? s.name),
  };
}

/**
 * The most recent snapshot from a DIFFERENT day.
 *
 * Excluding today matters: the second run of an afternoon would otherwise diff
 * against the first and report "nothing changed" as though a week had passed.
 * Nothing is a perfectly good answer; claiming it covers a week is not.
 */
export function previousSnapshot(runsDir, today = dayStamp(), fs = { existsSync, readdirSync, readFileSync }) {
  if (!fs.existsSync(runsDir)) return null;
  const files = fs.readdirSync(runsDir)
    .filter((f) => f.endsWith('.json') && f.slice(0, -5) !== today)
    .sort();
  if (!files.length) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(runsDir, files[files.length - 1]), 'utf8'));
  } catch {
    // A corrupt snapshot is not a reason to fail the run. The page says "first
    // run" instead, which is true of what it can compare against.
    return null;
  }
}

/**
 * What moved. Returns null when there is nothing to compare, never a diff of
 * zeroes: "no prior run" and "nothing changed" are different sentences and the
 * page prints whichever is true.
 */
export function diffSnapshots(prev, now) {
  if (!prev) return null;
  const byId = new Map((prev.checks || []).map((c) => [c.id, c]));
  const checks = [];
  for (const c of now.checks) {
    const was = byId.get(c.id);
    if (!was) { checks.push({ id: c.id, from: null, to: c.points, state: c.state, note: 'new check' }); continue; }
    if (was.points !== c.points || was.state !== c.state) {
      checks.push({ id: c.id, from: was.points, to: c.points, fromState: was.state, state: c.state });
    }
  }
  const prevGaps = new Set(prev.gaps || []);
  const nowGaps = new Set(now.gaps || []);
  const prevServers = new Set(prev.servers || []);
  const nowServers = new Set(now.servers || []);
  return {
    since: prev.day,
    letterFrom: prev.letter,
    letterTo: now.letter,
    pctFrom: prev.pct,
    pctTo: now.pct,
    checks,
    gapsOpened: [...nowGaps].filter((g) => !prevGaps.has(g)),
    gapsClosed: [...prevGaps].filter((g) => !nowGaps.has(g)),
    serversAdded: [...nowServers].filter((s) => !prevServers.has(s)),
    serversRemoved: [...prevServers].filter((s) => !nowServers.has(s)),
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATE_WORD = { pass: 'pass', warn: 'partial', fail: 'fail', 'n/a': 'skipped' };

function gradeSection(g) {
  if (g.letter === null) {
    return `<section><h2>Grade</h2><p class="muted">Not graded: nothing here could be measured.</p></section>`;
  }
  const rows = g.checks.map((c) => `
    <tr class="s-${c.state === 'n/a' ? 'na' : c.state}">
      <td class="mark">${esc({ pass: '✓', warn: '△', fail: '✗', 'n/a': '–' }[c.state])}</td>
      <td>${esc(c.label)}${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}</td>
      <td class="num">${c.state === 'n/a' ? '<span class="muted">skipped</span>' : `${c.points}/${c.max}`}</td>
      <td class="ev">${c.evidence ? `<code>${esc(c.evidence)}</code>` : ''}</td>
    </tr>`).join('');
  return `
  <section>
    <h2>Grade</h2>
    <div class="grade"><span class="letter g-${esc(g.letter)}">${esc(g.letter)}</span>
      <span class="score">${g.earned} / ${g.possible} <span class="muted">(${g.pct}%)</span></span></div>
    <table class="checks"><tbody>${rows}</tbody></table>
    <p class="fine">Skipped checks are left out of the denominator rather than scored zero. A build
    with no subagents has no exposure to measure, and scoring that zero would rank it below a build
    whose agents are wired badly. Capability gaps below are <strong>not</strong> in this grade: a
    missing tool is a recommendation about what you do not have, not a defect in what you do.</p>
  </section>`;
}

function changeSection(diff) {
  if (!diff) {
    return `<section><h2>What changed</h2><p class="muted">First run. Nothing to compare against yet.
      Run this again next week and this section fills in.</p></section>`;
  }
  const bits = [];
  if (diff.letterFrom !== diff.letterTo || diff.pctFrom !== diff.pctTo) {
    bits.push(`<li><strong>Grade</strong> ${esc(diff.letterFrom)} (${diff.pctFrom}%) &rarr;
      ${esc(diff.letterTo)} (${diff.pctTo}%)</li>`);
  }
  for (const c of diff.checks) {
    bits.push(`<li><code>${esc(c.id)}</code> ${c.from === null ? 'new check' : `${c.from} &rarr; ${c.to} points`}
      <span class="muted">(${esc(STATE_WORD[c.state] || c.state)})</span></li>`);
  }
  for (const g of diff.gapsClosed) bits.push(`<li>gap closed: <strong>${esc(g)}</strong></li>`);
  for (const g of diff.gapsOpened) bits.push(`<li>gap opened: <strong>${esc(g)}</strong></li>`);
  // One line per server reads fine for two and buries the page for forty, which
  // is what the first run after doctor learned to see plugins looked like.
  const serverLines = (list, verb) => list.length > 5
    ? [`<li>${list.length} servers ${verb}: ${list.slice(0, 5).map((s) => `<code>${esc(s)}</code>`).join(', ')} and ${list.length - 5} more</li>`]
    : list.map((s) => `<li>server ${verb}: <code>${esc(s)}</code></li>`);
  bits.push(...serverLines(diff.serversAdded, 'added'), ...serverLines(diff.serversRemoved, 'removed'));
  return `
  <section>
    <h2>What changed since ${esc(diff.since)}</h2>
    ${bits.length ? `<ul class="changes">${bits.join('')}</ul>`
      : `<p class="muted">Nothing moved since ${esc(diff.since)}.</p>`}
  </section>`;
}

function needsSection(res) {
  const gaps = res.needs?.gaps || [];
  const recs = res.recommendations || [];
  const parts = [`<h2>Recommendations</h2>`];
  if (!res.needs?.totalPrompts) {
    parts.push(`<p class="muted">No local prompt history was read, so there is nothing to recommend
      from. This is "not measured", not "no gaps".</p>`);
  } else if (!gaps.length) {
    parts.push(`<p class="muted">${res.needs.totalPrompts} prompt(s) read. No unmet capability
      showed up often enough to recommend a tool for.</p>`);
  } else {
    parts.push(`<p>${res.needs.totalPrompts} prompt(s) read. ${gaps.length}
      ${gaps.length === 1 ? 'capability' : 'capabilities'} the build keeps reaching for and cannot
      currently do:</p><ul class="gaps">`);
    for (const g of gaps) {
      const cands = (g.topCandidates || []).slice(0, 2).map((c) =>
        `<div class="cand"><span class="tag">worth measuring</span> <strong>${esc(c.name || c.url)}</strong>
         ${c.grade ? `<span class="tag g-${esc(c.grade)}">Grade ${esc(c.grade)}</span>` : ''}
         ${c.url ? `<div><code>${esc(c.url)}</code></div>` : ''}</div>`).join('');
      parts.push(`<li><strong>${esc(g.title || g.id)}</strong>
        <span class="muted">${g.promptsCount ?? 0} prompt(s)</span>
        ${cands || '<div class="muted">No graded candidate in the catalogue. That is a gap in our list, not proof none exists.</div>'}</li>`);
    }
    parts.push('</ul>');
  }
  if (recs.length) {
    parts.push(`<h3>Newly graded, not yet reviewed by you</h3><ul class="gaps">`);
    for (const r of recs) {
      parts.push(`<li><strong>${esc(r.server_name || r.server_url)}</strong>
        <span class="tag g-${esc(r.grade)}">Grade ${esc(r.grade)}</span>
        ${typeof r.score === 'number' ? `<span class="muted">${r.score.toFixed(1)}/100</span>` : ''}
        <div><code>${esc(r.server_url)}</code></div></li>`);
    }
    parts.push('</ul>');
  }
  parts.push(`<p class="fine">A match here means a candidate's own published text claims a capability
    your prompts keep asking for. It is <strong>worth measuring</strong>, never <em>fits</em>.
    Nothing on this page has been driven against your build.</p>`);
  return `<section>${parts.join('')}</section>`;
}

/** What the last `doorman review` found for one server, in words a reader cannot misread as a grade. */
/** A captured-surface finding, which is evidence about text but never a grade. */
function surfaceCell(sr) {
  if (!sr) return '';
  if (sr.status === 'invalid') return `<div class="muted">captured surface REFUSED: ${esc(sr.why)}</div>`;
  const head = sr.hard ? `<span class="tag g-F">SURFACE: injection-shaped text</span>`
    : sr.steering ? `<span class="tag g-C">SURFACE: commercial steering</span>`
    // Advisory carries no grade colour on purpose: it is a note to a reader,
    // not a mark against the server.
    : sr.advisory ? `<span class="tag">SURFACE: commercial promotion (advisory, not scored)</span>`
    : `<span class="tag g-A">surface clean</span>`;
  const modes = sr.failure_modes.slice(0, 3).map((m) => `<div class="muted">${esc(m)}</div>`).join('');
  return `<div>${head} <span class="muted">${esc(sr.tools_scanned)} tools, ${esc(sr.scanned_chars)} chars scanned, not connected</span>${modes}</div>`;
}

function reviewCell(s, rv, hasSurface = false) {
  if (s.transport === 'claude.ai') {
    return hasSurface
      ? '<span class="muted">no local url to connect to: reviewed from a captured surface</span>'
      : '<span class="muted">not reviewable here: the url and login live with your claude.ai account</span>';
  }
  if (!/^https?:\/\//.test(s.target || '')) return `<span class="muted">not reviewed: ${esc(s.transport || 'local')} servers are never run by review</span>`;
  if (!rv) return '<span class="muted">not reviewed yet</span>';
  if (rv.status === 'auth-required') return '<span class="tag">needs login</span> <span class="muted">tools not listed, nothing behind the login measured</span>';
  if (rv.status !== 'graded') return `<span class="tag">${esc(rv.status)}</span> <span class="muted">${esc(rv.hint || '')}</span>`;
  const p = rv.static_partial;
  const cov = p?.coverage ? `${p.coverage.ran} of ${p.coverage.ran + p.coverage.skipped} rules ran` : 'coverage unknown';
  // WHICH SURFACE THIS GRADE IS OVER, on every graded row.
  //
  // An authenticated audit and an anonymous one measure different servers as
  // far as the score is concerned, so two rows both reading "Grade A" invite a
  // comparison that cannot be made. The env var NAME is deliberately not
  // rendered: this page is a file on disk that people screenshot and send.
  const surface = rv.authenticated
    ? ' <span class="tag">authenticated</span>'
    : ' <span class="muted">anonymous</span>';
  return `<span class="tag g-${esc(rv.band)}">Grade ${esc(rv.band)}</span> <span class="muted">${esc(rv.score)}/100 static</span>`
    + surface
    + (p ? ` <span class="tag">PARTIAL</span> <span class="muted">${esc(cov)}</span>` : '')
    + (rv.hard_fail ? `<div class="muted">${esc(rv.hard_fail)}</div>` : '');
}

export function serversSection(res, reviews = {}, surfaces = {}) {
  const servers = res.doctor?.servers || [];
  if (!servers.length) {
    return `<section><h2>MCP servers</h2><p class="muted">No MCP servers are reachable from this project.</p></section>`;
  }
  const g = res.doctor?.gate || {};
  const allowed = new Set(g.allowed || []);
  const denied = new Set(g.denied || []);
  const trust = (n) => denied.has(n) ? '<span class="tag g-F">denied</span>'
    : allowed.has(n) ? '<span class="tag g-A">allowed</span>'
    : '<span class="tag">not decided</span>';
  const undecided = servers.filter((s) => !allowed.has(s.gateName) && !denied.has(s.gateName)).length;
  const rows = servers.map((s) => `
    <tr><td><code>${esc(s.gateName ?? s.name)}</code>
      <div class="muted">${esc((s.sources || [s.source]).join(', '))}</div>
      ${s.target ? `<div class="muted"><code>${esc(s.target)}</code></div>` : ''}</td>
      <td>${trust(s.gateName ?? s.name)}</td>
      <td>${reviewCell(s, s.target ? reviews[s.target] : null, Boolean(surfaces[s.gateName ?? s.name]))}${surfaceCell(surfaces[s.gateName ?? s.name])}</td></tr>`).join('');
  return `
  <section>
    <h2>MCP servers</h2>
    <p>${servers.length} server(s) an agent here can reach. ${undecided} not decided: the gate blocks those until you allow or deny them.</p>
    <table class="checks"><tbody>${rows}</tbody></table>
    <p class="fine">Reviewed is not approved. A grade is the free static layer (mcpscore plus the injection scan), not a
    measure of whether an agent can use the server. <code>doorman review</code> refreshes this table;
    <code>doorman allow &lt;server&gt;</code> is the decision.</p>
  </section>`;
}

function threatSection(res) {
  const t = res.threats || [];
  if (!t.length) {
    return `<section><h2>Blocked at the gate</h2><p class="muted">No server on your trust list is
      carrying a failing grade.</p></section>`;
  }
  return `<section><h2>Blocked at the gate</h2><ul class="gaps">${t.map((x) => `
    <li><strong>${esc(x.server_name || x.server_url)}</strong>
      <span class="tag g-F">Grade ${esc(x.grade)}</span>
      <div class="muted">${esc(x.hard_fail || 'failed the safety scan')}</div></li>`).join('')}</ul></section>`;
}

export function renderDashboardHtml(res, grade, diff, reviews = {}, surfaces = {}) {
  const actions = [];
  if (!res.posture?.isGateWired) actions.push('claude plugin install clembot-doorman');
  actions.push('doorman review', 'doorman allow &lt;server-name&gt;', '/vet &lt;candidate-url&gt;', 'doorman dashboard');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Doorman &middot; ${esc(path.basename(res.root))}</title>
<style>
  :root{--bg:#fbfaf8;--fg:#1a1a18;--muted:#6b6a66;--line:#e2e0da;--card:#fff;--green:#2f5d3f;--warn:#8a6b1f;--fail:#8c2f2f}
  @media (prefers-color-scheme:dark){:root{--bg:#14140f;--fg:#eceae4;--muted:#9b998f;--line:#2e2d27;--card:#1c1b16;--green:#7fb08f;--warn:#d3ad55;--fail:#dd8a8a}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:32px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:8px}
  h1{font-size:20px;margin:0 0 4px}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.07em;margin:34px 0 12px;color:var(--muted)}
  h3{font-size:14px;margin:22px 0 8px}
  section{border-bottom:1px solid var(--line)}
  section:last-of-type{border-bottom:0}
  .muted{color:var(--muted)}
  .fine{color:var(--muted);font-size:13px;margin:14px 0 22px}
  code{font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);border:1px solid var(--line);border-radius:3px;padding:1px 5px;word-break:break-all}
  .grade{display:flex;align-items:baseline;gap:14px;margin:4px 0 18px}
  .letter{font-size:56px;font-weight:650;line-height:1}
  .score{font-size:17px}
  .g-A{color:var(--green)}.g-B{color:var(--green)}.g-C{color:var(--warn)}.g-D{color:var(--warn)}.g-F{color:var(--fail)}
  table.checks{width:100%;border-collapse:collapse;margin-bottom:6px}
  table.checks td{padding:9px 8px;border-top:1px solid var(--line);vertical-align:top}
  td.mark{width:20px;font-weight:700}
  tr.s-pass td.mark{color:var(--green)}tr.s-warn td.mark{color:var(--warn)}tr.s-fail td.mark{color:var(--fail)}tr.s-na td.mark{color:var(--muted)}
  td.num{width:64px;text-align:right;white-space:nowrap}
  td.ev{width:38%}
  ul.changes,ul.gaps,ul.actions{margin:0;padding-left:20px}
  ul.changes li,ul.gaps li{margin-bottom:10px}
  .cand{margin:6px 0 0 0;padding:8px 10px;background:var(--card);border:1px solid var(--line);border-radius:5px}
  .tag{display:inline-block;white-space:nowrap;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:3px;padding:1px 6px;color:var(--muted)}
  .actions li{margin-bottom:7px}
  footer{margin-top:36px;color:var(--muted);font-size:13px}
  @media (max-width:560px){td.ev{display:none}.letter{font-size:44px}}
</style></head>
<body><div class="wrap">
<header>
  <h1>Your agent harness, graded</h1>
  <div class="muted"><code>${esc(res.root)}</code></div>
  <div class="muted">${esc(res.timestamp)} &middot; read-only, nothing here was executed or billed</div>
</header>
${gradeSection(grade)}
${changeSection(diff)}
${serversSection(res, reviews, surfaces)}
${needsSection(res)}
${threatSection(res)}
<section>
  <h2>Next</h2>
  <ul class="actions">${actions.map((a) => `<li><code>${a}</code></li>`).join('')}</ul>
</section>
<footer>Generated by <code>doorman dashboard</code>. The grade is arithmetic over the checks above and
nothing else; recompute it by hand if you disagree with it.</footer>
</div></body></html>
`;
}

/** Best-effort. A browser that will not open is not a failed run. */
function openInBrowser(file) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]]
    : process.platform === 'darwin' ? ['open', [file]]
    : ['xdg-open', [file]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

export async function dashboard(targetDir = process.cwd(), opts = {}) {
  const res = await auditProject(targetDir, opts);
  if (!res.ok) return { ok: false, why: res.why };

  const grade = gradeBuild(res.doctor);
  const outDir = path.join(res.root, OUT_DIR);
  const runsDir = path.join(outDir, 'runs');
  mkdirSync(runsDir, { recursive: true });

  const snap = snapshotOf(res, grade);
  const prev = previousSnapshot(runsDir, snap.day);
  const diff = diffSnapshots(prev, snap);

  const runFile = path.join(runsDir, `${snap.day}.json`);
  writeFileSync(runFile, JSON.stringify(snap, null, 2), 'utf8');

  const htmlFile = path.join(outDir, 'report.html');
  const captures = readSurfaces(res.root);
  const surfaceReviews = {};
  for (const [gate, cap] of Object.entries(captures)) {
    if (gate !== '__unreadable') surfaceReviews[gate] = reviewSurface(cap);
  }
  writeFileSync(htmlFile, renderDashboardHtml(res, grade, diff, readReviews(res.root), surfaceReviews), 'utf8');

  const opened = opts.open === false ? false : openInBrowser(htmlFile);

  return { ok: true, root: res.root, grade, diff, htmlFile, runFile, opened,
           gaps: (res.needs?.gaps || []).length, prompts: res.needs?.totalPrompts ?? 0 };
}

export function renderDashboard(r) {
  const L = [''];
  L.push(`  grade    ${r.grade.letter ?? 'n/a'}  ${r.grade.earned}/${r.grade.possible}` +
         (r.grade.pct === null ? '' : ` (${r.grade.pct}%)`));
  L.push(`  needs    ${r.prompts} prompt(s) read, ${r.gaps} gap(s)`);
  L.push(r.diff
    ? `  since    ${r.diff.since}: ${r.diff.checks.length} check change(s), ` +
      `${r.diff.gapsClosed.length} gap(s) closed, ${r.diff.gapsOpened.length} opened`
    : `  since    first run, nothing to compare yet`);
  L.push(`  wrote    ${r.htmlFile}`);
  L.push(`  snapshot ${r.runFile}`);
  L.push(r.opened ? `  opened   in your default browser` : `  open it  ${r.htmlFile}`);
  L.push('');
  return L.join('\n');
}
