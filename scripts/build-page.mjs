/**
 * Build a secondary site page from a content fragment plus the site's own
 * stylesheet.
 *
 *   node scripts/build-page.mjs direction "Where clembot-doorman is headed"
 *
 * Reads scripts/pages/<name>.html and writes site/<name>.html.
 *
 * The stylesheet is taken from site/index.html at build time rather than
 * duplicated. Two copies of a 45KB sheet drift the first time anyone touches
 * either, and drift silently: both pages still render, they just stop agreeing
 * about what the brand looks like.
 *
 * Fragments live OUTSIDE site/ on purpose. Anything inside site/ is uploaded by
 * `wrangler pages deploy site`, so a fragment kept there would be served as a
 * half-page with no stylesheet to anyone who found the url.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..', 'site');
const SRC = path.join(SITE, 'index.html');

const [name, title, description] = process.argv.slice(2);
if (!name) {
  console.error('usage: node scripts/build-page.mjs <name> [title] [description]');
  process.exitCode = 2;
  throw new Error('no page name given');
}

const fragmentPath = path.join(HERE, 'pages', `${name}.html`);
if (!fs.existsSync(fragmentPath)) {
  console.error(`build-page: no fragment at scripts/pages/${name}.html`);
  process.exitCode = 2;
  throw new Error('missing fragment');
}

const html = fs.readFileSync(SRC, 'utf8');
const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
if (!styleMatch) {
  console.error('build-page: could not find the <style> block in site/index.html.');
  console.error('Fix this script rather than pasting a copy of the stylesheet.');
  process.exitCode = 1;
  throw new Error('no stylesheet');
}
const css = styleMatch[1];

// The scroll sweep that adds `.in` to `.reveal` lives in the index page's
// driver script, which this page does not ship. Reveal everything up front
// rather than serving a page whose content never becomes visible.
const body = fs.readFileSync(fragmentPath, 'utf8').replace(/\breveal\b/g, 'reveal in');

const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  `<title>${title || name} | clembot doorman</title>`,
  description ? `<meta name="description" content="${description}">` : '',
  '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
  '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Archivo:wght@400;500;600&family=Barlow+Condensed:wght@500;600&display=swap" rel="stylesheet">',
].filter(Boolean).join('\n');

const out = `<!doctype html>
<html lang="en" class="js">
<head>
${head}
<style>
${css}
/* secondary pages have no hero canvas, so the masthead divider is fixed on load */
.masthead { border-bottom-color: var(--border); }
/* secondary pages have no hero canvas, so the first section needs its own air */
#hero-direction { padding-top: var(--sp-12, 3rem); }
#hero-direction h1 { max-width: 22ch; }
#rail .refuse-grid { margin-top: var(--sp-8); }
.next-head { margin-top: var(--sp-12, 3rem); margin-bottom: var(--sp-4, 1rem); }
</style>
</head>
<body>
${body}
<script src="/glossary.js" defer></script>
</body>
</html>
`;

const dest = path.join(SITE, `${name}.html`);
fs.writeFileSync(dest, out, 'utf8');
console.log(`site/${name}.html  ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);
console.log(`  css      ${(css.length / 1024).toFixed(0)} KB (shared with index.html)`);
console.log(`  content  ${(body.length / 1024).toFixed(0)} KB`);
