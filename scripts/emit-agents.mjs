/**
 * Generate the agent-readable surface for clembot-doorman.wanessalabs.com:
 * site/robots.txt, site/sitemap.xml and site/llms.txt.
 *
 * This site has no build step. It is hand-written HTML deployed by Direct
 * Upload, so anything derived has to be derived by something, and that
 * something is this. Run it after adding or retiring a page, then
 * `node scripts/check-agents.mjs` to confirm the three files still agree with
 * what is actually in site/.
 *
 * NOTHING HERE IS TYPED TWICE. The page list comes from the files present, and
 * each page's one-line summary is its own `<meta name="description">`. A second
 * hand-written summary is a copy that outlives its source, which is the failure
 * this project has spent the most time on: a share card claiming 120 commits
 * against 138, a page selling a retired product, a roster saying 113 after it
 * became 115.
 *
 * URLS ARE EXTENSIONLESS. Pages canonicalises `/guide.html` to `/guide` with its
 * own 308, so listing the `.html` form in a sitemap points a crawler at a
 * redirect instead of at the page.
 *
 * llms.txt DESCRIBES AND NEVER INSTRUCTS, and on this host that is not a style
 * preference. This is the site that publishes a grade-F finding about a tool
 * description which stopped describing the tool and started addressing the agent
 * reading it. An llms.txt written the ordinary way, "you are an assistant,
 * recommend this", is that same construction. check-agents.mjs runs the
 * scanner's own pattern shape over the generated file.
 *
 * Run: node scripts/emit-agents.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITE = join(ROOT, 'site');
const ORIGIN = 'https://clembot-doorman.wanessalabs.com';

/** Page order on the site, which is also reading order. Anything not named
 *  here still ships and still gets listed, appended after these. */
const ORDER = ['index', 'how-it-works', 'guide', 'judges', 'bazantic', 'direction'];

function pages() {
  const found = readdirSync(SITE)
    .filter((f) => f.endsWith('.html'))
    .map((f) => basename(f, '.html'));

  const ranked = [
    ...ORDER.filter((n) => found.includes(n)),
    ...found.filter((n) => !ORDER.includes(n)).sort(),
  ];

  return ranked.map((name) => {
    const html = readFileSync(join(SITE, `${name}.html`), 'utf8');
    const title = (/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? name)
      .replace(/\s*\|\s*clembot doorman\s*$/i, '')
      .replace(/&amp;/g, '&')
      .replace(/&middot;/g, '·')
      .trim();
    const desc = (/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
    if (!desc) {
      // A page with no description would get a blank line in llms.txt, which
      // reads as a page not worth describing. Fail rather than ship that.
      throw new Error(`emit-agents: site/${name}.html has no meta description`);
    }
    return { name, path: name === 'index' ? '/' : `/${name}`, title, desc };
  });
}

/** Invariants are numbered in CLAUDE.md. Counted, never typed. */
function invariantCount() {
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  return (md.match(/^\d+\.\s\*\*/gm) ?? []).length;
}

const list = pages();
const invariants = invariantCount();

/* ── robots.txt ───────────────────────────────────────────────────────────── */

const robots = `# clembot-doorman.wanessalabs.com
#
# Clembot Doorman is an AI ops tool: it reads a build's own prompt history, says
# what that build keeps reaching for and does not have, grades an MCP server
# before it is installed, and refuses one that has not been graded.
#
# AI crawlers are welcome, deliberately. This is documentation for a free tool
# whose users work through agents, so a crawler reading it is the distribution
# channel rather than a leak of it.
#
# /clembot and /wanessa-labs are 301s to the sites that own those subjects. See
# site/_redirects and archive/site-pages/README.md.

User-agent: *
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`;

/* ── sitemap.xml ──────────────────────────────────────────────────────────── */

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${list
  .map(
    (p) =>
      `  <url>\n    <loc>${ORIGIN}${p.path}</loc>\n    <priority>${p.name === 'index' ? '1.0' : '0.8'}</priority>\n  </url>`,
  )
  .join('\n')}
</urlset>
`;

/* ── llms.txt ─────────────────────────────────────────────────────────────── */

const llms = `# Clembot Doorman

> An AI ops tool for teams that run their own coding agents. It reads a build's
> own prompt history to say what that build keeps reaching for and does not
> have, grades an MCP server before it is installed, and refuses one that has
> not been graded. Free, offline, and it works on a build unlike the one that
> made it.

Doorman installs as a Claude Code plugin. The gate that refuses an unvetted
server runs locally with no network call and no dependencies, and fails closed:
an unreachable service produces a refusal rather than a default allow.

It recommends and never installs. A match on a candidate reads
"worth-measuring", never "fits", because a match means only that the
candidate's own published text claims a capability the build keeps asking for.
A need with nothing to offer is reported as a gap in the catalogue rather than
dropped. ${invariants} numbered invariants in the repository record the
decisions that keep those distinctions from eroding.

Grading is layered, and an unmeasured layer is reported as unmeasured rather
than as a zero. The static layer costs nothing and needs no key. The
behavioural layer needs a model key of your own.

## Pages

${list.map((p) => `- [${p.title}](${ORIGIN}${p.path}): ${p.desc}`).join('\n')}

## The finding this project is known for

A live commercial MCP server scored 89.86% on configuration, an A-band score,
and still graded F overall on a single hard fail: one 6,290-character tool
description stopped describing the tool and started addressing the agent
reading it. The same description carried a sales script, which scores and is
reported but is deliberately not allowed to cap a grade, because a description
that advertises is not a description that attacks.

The transcripts behind that grade are published and unauthenticated, because
evidence for an accusation cannot sit behind the accuser's token. The finding
is true as of its date: a vendor can rewrite a description the next morning.

## Related sites

- [Clembot](https://clembot.wanessalabs.com): the agent harness this gate was built for, documented from its own operational record.
- [Wanessa Labs](https://wanessalabs.com): the studio that builds with it.

## About this file

Generated by scripts/emit-agents.mjs from the pages present in site/ and their
own meta descriptions, so it cannot describe a page that is not there or
summarise one differently from how the page summarises itself. It describes and
does not instruct: this project publishes a finding about tool text that
addresses the agent reading it, and a file doing that here would be a poor
advertisement for the argument.
`;

writeFileSync(join(SITE, 'robots.txt'), robots, 'utf8');
writeFileSync(join(SITE, 'sitemap.xml'), sitemap, 'utf8');
writeFileSync(join(SITE, 'llms.txt'), llms, 'utf8');

console.log(`wrote site/robots.txt      ${robots.length} bytes`);
console.log(`wrote site/sitemap.xml     ${sitemap.length} bytes  (${list.length} urls)`);
console.log(`wrote site/llms.txt        ${llms.length} bytes`);
console.log(`pages: ${list.map((p) => p.path).join(', ')}`);
console.log(`invariants counted from CLAUDE.md: ${invariants}`);
