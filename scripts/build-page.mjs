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

const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/);
const footerHtml = footerMatch ? footerMatch[0] : '';

const navJsPath = path.join(SITE, 'nav.js');
const navJs = fs.existsSync(navJsPath) ? fs.readFileSync(navJsPath, 'utf8') : '';

// The scroll sweep that adds `.in` to `.reveal` lives in the index page's
// driver script, which this page does not ship. Reveal everything up front
// rather than serving a page whose content never becomes visible.
let body = fs.readFileSync(fragmentPath, 'utf8').replace(/\breveal\b/g, 'reveal in');
if (footerHtml && /<footer[\s\S]*?<\/footer>/.test(body)) {
  body = body.replace(/<footer[\s\S]*?<\/footer>/, footerHtml);
}

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
/* secondary pages masthead divider is fixed on load */
.masthead { border-bottom-color: var(--border); }
#hero-direction { padding-top: var(--sp-12, 3rem); }
#hero-direction h1 { max-width: 22ch; }
#rail .refuse-grid { margin-top: var(--sp-8); }
.next-head { margin-top: var(--sp-12, 3rem); margin-bottom: var(--sp-4, 1rem); }

/* ── Native Bazantic Recipe Showcase Cards ─────────────────────────────── */
.recipe-grid {
  display: grid;
  gap: var(--sp-5);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  margin-top: var(--sp-6);
}
.recipe-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: clamp(20px, 2.5vw, 28px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: border-color .2s var(--ease-signature), transform .2s var(--ease-signature), box-shadow .2s var(--ease-signature);
}
.recipe-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
}
.recipe-card .tldr-badge {
  display: inline-block;
  align-self: flex-start;
  font-family: var(--font-label);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 3px 10px;
  margin-bottom: var(--sp-3);
}
.recipe-card h3 {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--sp-2);
}
.recipe-card p {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 var(--sp-3);
}
.recipe-card p b, .recipe-card p strong {
  color: var(--text-primary);
}
.recipe-card ul {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.6;
  padding-left: var(--sp-4);
  margin: 0 0 var(--sp-4);
}
.recipe-card ul li {
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.recipe-card ul li b, .recipe-card ul li strong {
  color: var(--text-primary);
}
.recipe-card code {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.8125rem;
}
.recipe-card details {
  margin-top: auto;
  padding-top: var(--sp-2);
  border-top: 1px dashed var(--border);
}
.recipe-card details summary {
  cursor: pointer;
  color: var(--accent);
  font-weight: 600;
  font-family: var(--font-label);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.8125rem;
  user-select: none;
  padding-block: 4px;
  transition: color .2s var(--ease-signature);
}
.recipe-card details summary:hover {
  color: var(--accent-hover);
}
.recipe-card details pre {
  margin-top: var(--sp-2);
  padding: var(--sp-3);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-primary);
  overflow-x: auto;
  line-height: 1.45;
}
.recipe-card .btn-recipe {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: var(--sp-4);
  padding: 8px 16px;
  background: var(--accent);
  color: #ffffff !important;
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: 0.8125rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: transform .2s var(--ease-signature), background .2s var(--ease-signature);
}
.recipe-card .btn-recipe:hover {
  background: var(--accent-hover);
  color: #ffffff !important;
  transform: translateY(-1px);
  text-decoration: none;
}

/* Founder showcase styles */
.founder-card {
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: clamp(20px, 3.5vw, 36px);
  margin-top: var(--sp-6);
}
.founder-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: clamp(20px, 3.5vw, 40px);
  align-items: start;
}
.founder-media {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.founder-portrait-frame {
  width: 200px;
  height: 200px;
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 5px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.founder-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: calc(var(--radius-md) - 3px);
  display: block;
  background: #ffffff;
}
.founder-caption {
  margin-top: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.founder-caption-name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.0625rem;
  color: var(--text-primary);
  line-height: 1.2;
}
.founder-caption-role {
  font-family: var(--font-label);
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}
.founder-info {
  min-width: 0;
}
.founder-name-heading {
  font-family: var(--font-display);
  font-size: clamp(1.35rem, 2.2vw, 1.75rem);
  font-weight: 800;
  color: var(--text-primary);
  margin: 0 0 var(--sp-2);
  line-height: 1.2;
}
.founder-bio {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 var(--sp-3);
}
.founder-meta-chips {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--sp-3);
  margin: var(--sp-4) 0;
  padding: var(--sp-4);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.founder-actions {
  display: flex;
  gap: var(--sp-3);
  flex-wrap: wrap;
  align-items: center;
  margin-top: var(--sp-4);
}
@media (max-width: 680px) {
  .founder-layout {
    grid-template-columns: 1fr;
    gap: var(--sp-5);
  }
  .founder-media {
    margin-bottom: var(--sp-2);
  }
  .founder-portrait-frame {
    width: 170px;
    height: 170px;
  }
}
</style>
</head>
<body>
${body}
<script>${navJs}</script>
<script src="/glossary.js" defer></script>
<script src="/hero-canvas.js" defer></script>
</body>
</html>
`;

const dest = path.join(SITE, `${name}.html`);
fs.writeFileSync(dest, out, 'utf8');
console.log(`site/${name}.html  ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);
console.log(`  css      ${(css.length / 1024).toFixed(0)} KB (shared with index.html)`);
console.log(`  content  ${(body.length / 1024).toFixed(0)} KB`);
