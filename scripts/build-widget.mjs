/**
 * Build the embeddable flow widget from the site, rather than beside it.
 *
 * The widget is the same demo the site runs, in one file you can iframe
 * anywhere. It is GENERATED, never hand-maintained, because a hand-copied
 * second copy of a 12KB driver and a 45KB stylesheet drifts from the original
 * the first time anyone edits either, and drifts silently: both would still
 * run, they would just disagree.
 *
 *   node scripts/build-widget.mjs
 *
 * Writes site/embed/flow.html. Re-run it after touching the flow.
 *
 * The whole stylesheet is inlined rather than a computed subset. Working out
 * which rules a fragment needs is a guess that fails quietly on the one
 * selector you missed, and the entire sheet is 45KB. Correct beats small here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..', 'site');
const SRC = path.join(SITE, 'index.html');
const OUT_DIR = path.join(SITE, 'embed');
const OUT = path.join(OUT_DIR, 'flow.html');

const html = fs.readFileSync(SRC, 'utf8');

/** Fail loudly and say which extraction broke. A widget built from a partial
 *  match looks fine until someone clicks Run. */
function must(value, what) {
  if (!value) {
    console.error(`build-widget: could not find ${what} in site/index.html.`);
    console.error('The markers moved. Fix this script rather than hand-editing the widget.');
    process.exitCode = 1;
    throw new Error(what);
  }
  return value;
}

const css = must(html.match(/<style[^>]*>([\s\S]*?)<\/style>/), 'the <style> block')[1];

const flow = must(
  html.match(/<div class="ink" id="flow">[\s\S]*?\n<\/div>\n/),
  'the #flow block',
)[0];

// The driver is the one script that defines run(). Selecting by index would
// break the first time a script is added above it.
const scripts = [...html.matchAll(/<script(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]);
const driver = must(scripts.find((s) => /function run\s*\(/.test(s)), 'the flow driver script');

// The site marks elements .reveal and the driver's scroll sweep adds .in. The
// sweep needs a scrollable page and the widget is one screen, so reveal
// everything up front rather than depending on a scroll that never happens.
const revealed = flow.replace(/\breveal\b/g, 'reveal in');

// The API base comes from a meta tag on the site. Without it the widget loads,
// looks perfectly correct, and every run reports "no scorecard configured".
const apiMeta = must(
  html.match(/<meta name="scorecard-api"[^>]*>/),
  'the <meta name="scorecard-api"> tag',
)[0];

/**
 * DRIFT GUARD.
 *
 * The driver is the site's whole front-end script, not a flow module: it also
 * owns the masthead and the nav. Those two ids are not in the flow block, so
 * the widget stubs them. If the driver later reaches for a THIRD element that
 * lives elsewhere on the page, the widget would load, throw once during init,
 * and then sit there with a dead Run button and a clean-looking page. That is
 * the failure this check exists to make loud.
 */
const KNOWN_CHROME = ['masthead', 'nav'];
const wanted = new Set();
for (const m of driver.matchAll(/\$\('([a-zA-Z0-9_-]+)'\)/g)) wanted.add(m[1]);
for (const m of driver.matchAll(/getElementById\('([a-zA-Z0-9_-]+)'\)/g)) wanted.add(m[1]);
for (const m of driver.matchAll(/querySelector(?:All)?\('#([a-zA-Z0-9_-]+)/g)) wanted.add(m[1]);
const stubbed = [...wanted].filter((id) => !flow.includes(`id="${id}"`));
const unexpected = stubbed.filter((id) => !KNOWN_CHROME.includes(id));
if (unexpected.length) {
  console.error('build-widget: the driver now needs elements the widget does not provide:');
  unexpected.forEach((id) => console.error(`  #${id}`));
  console.error('Add a stub for each in the shell below, or move that code out of the driver.');
  console.error('Refusing to write a widget whose Run button would throw on load.');
  // `process.exitCode`, not `process.exit()`. Invariant 6: on Node 25 / Windows
  // exit() trips a libuv assertion with open sockets and replaces the real code
  // with 127, so a refusal would report as a crash.
  process.exitCode = 1;
  throw new Error('widget would be broken: missing ' + unexpected.join(', '));
}
console.log(`drift guard: ${wanted.size} ids used, ${stubbed.length} stubbed (${stubbed.join(', ') || 'none'})`);

const out = `<!doctype html>
<html lang="en" class="js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doorman: should I adopt this server?</title>
<meta name="robots" content="noindex">
<meta name="description" content="A live run of the doorman adoption flow. Grades a real MCP server, prices the measurement, and decides.">
${apiMeta}
<style>
${css}
/* widget-only: this file is a fragment on its own page, so it owns the frame */
body { margin: 0; padding: var(--sp-6, 1.5rem) 0; background: var(--bg); }
#flow { margin: 0; }
.widget-foot {
  max-width: 62rem; margin: var(--sp-5, 1.25rem) auto 0; padding: 0 var(--sp-5, 1.25rem);
  font-size: .8125rem; color: var(--text-muted); text-align: center;
}
.widget-foot a { color: inherit; }
</style>
</head>
<body>
<!-- The driver owns the site's masthead and nav as well as the flow. Stubbed so
     its init does not throw; hidden because a widget has no chrome of its own. -->
<header id="masthead" hidden></header>
<nav id="nav" hidden></nav>
${revealed}
<p class="widget-foot">
  A live call to <a href="https://scorecard.wanessalabs.com">scorecard.wanessalabs.com</a>.
  The grade, the audit id and the evidence hash are real.
  <a href="https://clembot-doorman.wanessalabs.com">clembot-doorman.wanessalabs.com</a>
</p>
<script>
${driver}
</script>
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');

const kb = (n) => (n / 1024).toFixed(0);
console.log(`site/embed/flow.html  ${kb(Buffer.byteLength(out))} KB`);
console.log(`  css    ${kb(css.length)} KB`);
console.log(`  markup ${kb(flow.length)} KB`);
console.log(`  driver ${kb(driver.length)} KB`);
