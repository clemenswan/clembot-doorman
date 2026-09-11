/**
 * Layout and contrast check for site/index.html.
 *
 *   node clembot-doorman/scripts/check-site.mjs
 *
 * RUN IT FROM THE VAULT ROOT. Playwright is installed there, not in this
 * project, and importing it from here fails with ERR_MODULE_NOT_FOUND.
 *
 * WHY THIS IS COMMITTED. A version of this has now been written three times,
 * from scratch, in three sessions, and got the SAME measurement wrong twice.
 * The failure is worth stating plainly because it is invisible:
 *
 *   getComputedStyle returns `oklch(...)` on this site, and canvas `fillStyle`
 *   silently REJECTS oklch. It does not throw. The previous fill colour stays,
 *   every element resolves to the same wrong pixel, and the page scores about
 *   1.04:1 across the board. That reads as a catastrophic contrast failure on
 *   a design that is actually fine.
 *
 * Two defences, both mandatory:
 *
 *   1. Resolve colour through `color-mix(in srgb, X 100%, transparent 0%)`,
 *      which forces the engine to hand back `color(srgb r g b)` using the same
 *      conversion the renderer uses.
 *   2. Always probe a CONTROL element that already shipped. If the control
 *      scores the same as the new work, the PROBE is broken, not the page.
 *      That is exactly how both previous failures were caught, and it is the
 *      only assertion here that cannot be fooled by a bad colour parser.
 *
 * Layout is checked the same way: wrapping is not overflow, so it measures a
 * leaf that broke its own text as well as the document width.
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = process.argv[2] || path.join(HERE, '..', 'site', 'index.html');
const WIDTHS = [[1440, 900], [1280, 900], [900, 900], [390, 844]];

/** fg selector, and a one-line label. Add new work here. */
const TEXT = [
  ['.ladder-cmd code', 'ladder: command'],
  ['.ladder-lvl', 'ladder: L-level'],
  ['.ladder-q strong', 'ladder: question'],
  ['.ladder-q p', 'ladder: body'],
  ['.ladder-pill.free', 'ladder: free pill'],
  ['.ladder-row[data-lane="paid"] .ladder-pill.paid', 'ladder: price pill on raised bg'],
  ['.ladder-pill.yours', 'ladder: your-key pill'],
  ['.ladder-where', 'ladder: where'],
  ['.ladder-row[data-lane="paid"] .ladder-q p', 'ladder: body on the raised bg'],
  ['.ab-metric .m-val', 'A/B: not-measured value'],
  ['.tldr-lead', 'TL;DR lead'],
  // CONTROLS. These shipped and were verified. They must score DIFFERENTLY
  // from each other, or the probe is resolving everything to one colour.
  ['#audits tbody tr .server', 'CONTROL shipped: server name'],
  ['.section-intro', 'CONTROL shipped: section intro'],
];

const browser = await chromium.launch();
let problems = 0;

// ── layout ────────────────────────────────────────────────────────────────
for (const [w, h] of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(pathToFileURL(PAGE).href, { waitUntil: 'load' });
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
  await page.waitForTimeout(300);

  const r = await page.evaluate((vw) => {
    const leaves = [];
    for (const el of document.querySelectorAll('code, .ladder-pill, .ladder-lvl, h1, h2, h3, .p-tab')) {
      if (el.scrollWidth > el.clientWidth + 1) leaves.push(el.textContent.trim().slice(0, 30));
    }
    return { docW: document.documentElement.scrollWidth, over: document.documentElement.scrollWidth > vw + 1, leaves };
  }, w);

  const ok = !r.over && r.leaves.length === 0;
  if (!ok) problems++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${String(w).padStart(4)}px  doc=${r.docW}` +
    (r.leaves.length ? `  clipped: ${r.leaves.join(' | ')}` : ''));
  await page.close();
}

// ── contrast ──────────────────────────────────────────────────────────────
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(pathToFileURL(PAGE).href, { waitUntil: 'load' });
await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
await page.waitForTimeout(300);

const rows = await page.evaluate((text) => {
  const probeEl = document.createElement('div');
  document.body.appendChild(probeEl);
  const rgb = (css) => {
    probeEl.style.backgroundColor = '';
    probeEl.style.backgroundColor = `color-mix(in srgb, ${css} 100%, transparent 0%)`;
    const v = getComputedStyle(probeEl).backgroundColor;
    const m = v.match(/-?[0-9.]+/g);
    if (!m) return [255, 255, 255, 1];
    if (v.startsWith('color(')) {
      return [+m[0] * 255, +m[1] * 255, +m[2] * 255, m.length > 3 ? +m[3] : 1];
    }
    return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // Walk up to the first OPAQUE ancestor. Stopping at the element's own
  // transparent background once scored an unreadable block at 11.5:1.
  const groundOf = (el) => {
    let n = el;
    while (n) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c[3] > 0.95) return c;
      n = n.parentElement;
    }
    return [255, 255, 255, 1];
  };

  return text.map(([sel, label]) => {
    const el = document.querySelector(sel);
    if (!el) return { label, missing: true };
    const cs = getComputedStyle(el);
    const [a, b] = [lum(rgb(cs.color)), lum(groundOf(el))].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && (parseInt(cs.fontWeight, 10) || 400) >= 700);
    const min = large ? 3 : 4.5;
    return { label, ratio: +ratio.toFixed(2), min, pass: ratio >= min };
  });
}, TEXT);

let worst = 99;
const controls = [];
for (const r of rows) {
  if (r.missing) { console.log(`  MISSING  ${r.label}`); problems++; continue; }
  if (!r.pass) problems++;
  if (r.ratio < worst) worst = r.ratio;
  if (r.label.startsWith('CONTROL')) controls.push(r.ratio);
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${String(r.ratio).padStart(6)}:1  (min ${r.min})  ${r.label}`);
}

// The assertion that catches a broken probe. Two controls with different
// colours must not resolve to the same number.
if (controls.length >= 2 && new Set(controls).size === 1) {
  console.log(`\n  BROKEN PROBE: both controls scored ${controls[0]}:1. Colour resolution is`);
  console.log('  collapsing every element to one value. Do NOT act on the numbers above.');
  problems++;
}

await browser.close();
console.log(`\n  lowest pair ${worst}:1`);
console.log(problems ? `  ${problems} problem(s)` : '  layout and contrast both clean');
process.exitCode = problems ? 1 : 0;
