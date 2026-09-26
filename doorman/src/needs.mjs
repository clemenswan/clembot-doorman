/**
 * `doorman needs` - what THIS build keeps reaching for, read from its own history.
 *
 * The gap this closes. `doctor` reads what a build HAS. `watch` reads what has
 * been graded lately and says which rows are new to this build. Neither one can
 * answer the question anybody actually asks first, which is "what should I
 * install". `watch` refuses to answer it on purpose: it does a mechanical
 * overlap check and the comment at the top of that file says in as many words
 * that it must never emit the word `fits`.
 *
 * So this reads a third thing: the prompts already typed into this build. Not
 * the code, not the config, the asks. A build whose operator has typed
 * "cloudflare" forty times and has no deployment server is a measurable gap,
 * and the evidence is a count of their own sentences rather than a guess about
 * their intentions.
 *
 * WHAT THIS IS NOT, and the file is structured so it cannot drift into it:
 *
 *   - It is not a recommendation that a server will work. Nothing here drives
 *     anything. A match means the candidate's OWN published text claims the
 *     capability this build keeps asking for. That is a reason to measure it,
 *     which is why the verdict word is `worth-measuring` and never `fits`.
 *   - It never scores or grades. Grades come from the feed, already measured,
 *     and a candidate with no grade is reported as ungraded rather than given
 *     a benefit of the doubt.
 *   - It never sends the history anywhere. Reading is local, matching is local,
 *     and the single network call in the CLI is the same anonymous GET /feed
 *     that `watch` makes. The prompts never leave the machine.
 *
 * A need with NO candidate is reported, not dropped. "Nothing graded covers
 * this" is the most useful line in the output and the easiest one to lose.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * The capability taxonomy.
 *
 * Every term is a substring matched on word boundaries, and the matched term is
 * carried into the output so a human can see exactly why a line appeared.
 * Terms are deliberately specific. `search` alone would match "search the
 * codebase", which is not a web-search need; `search the web` would not.
 *
 * This list is short on purpose. A taxonomy with eighty buckets looks thorough
 * and cannot be checked by hand against a real corpus, and an unchecked bucket
 * is a confident wrong answer waiting for a user.
 */
export const NEEDS = [
  {
    id: 'docs-lookup',
    label: 'Current documentation for a library it does not know',
    why: 'A model answers from training data. Where the library moved, it answers wrongly and confidently.',
    terms: ['read the docs', 'documentation for', 'api reference', 'latest docs',
      'official docs', 'deepwiki', 'context7', 'library docs', 'check the docs'],
    catalog: ['docs', 'documentation', 'javadocs', 'devdocs'],
  },
  {
    id: 'web-search',
    label: 'Reading the live web',
    why: 'Anything after the cutoff is unreachable without a fetch.',
    terms: ['search the web', 'web search', 'search online', 'look it up online',
      'google it', 'latest news', 'what is the current', 'find current'],
    catalog: ['search'],
  },
  {
    id: 'browser-automation',
    label: 'Driving a real browser',
    why: 'Layout, contrast and rendering cannot be asserted from source. This project learned that twice.',
    terms: ['playwright', 'puppeteer', 'headless chrome', 'browser automation',
      'screenshot the page', 'in a real browser', 'click the button'],
    catalog: ['browser', 'screenshot'],
  },
  {
    id: 'code-host',
    label: 'Issues, pull requests and repository state',
    why: 'Reading a repo from disk misses everything that lives in the forge.',
    terms: ['github', 'pull request', 'open a pr', 'gitlab', 'github issue',
      'the pr ', 'merge the pr'],
    catalog: ['gitlab', 'repo', 'git'],
  },
  {
    id: 'database',
    label: 'Querying the database directly',
    why: 'Guessing at a schema produces migrations that pass review and fail on real rows.',
    terms: ['supabase', 'postgres', 'sql query', 'the database', 'run a migration',
      'd1 database'],
    catalog: ['sql', 'database', 'duckdb', 'sqlite'],
  },
  {
    id: 'observability',
    label: 'Production errors and logs',
    why: 'A bug that only exists in production is invisible to every local test.',
    terms: ['sentry', 'error tracking', 'production logs', 'tail the logs',
      'stack trace from prod', 'observability', 'production error'],
    catalog: ['logs', 'metrics', 'tracing'],
  },
  {
    id: 'cloud-deploy',
    label: 'Deploying, and reading back what deployed',
    why: 'Most of this vault\u2019s recorded deploy failures were invisible until something read the deployment back.',
    terms: ['cloudflare', 'wrangler', 'pages deploy', 'deploy it', 'deploy so i can',
      'cloudflare worker', 'vercel', 'netlify'],
    catalog: ['deploy', 'hosting'],
  },
  {
    id: 'design-assets',
    label: 'Design files and rendered output',
    why: 'A design system in a file and a design on screen drift, and only one of them is what a visitor sees.',
    terms: ['figma', 'design tokens', 'og image', 'the mockup', 'brand.md',
      'take a screenshot'],
    catalog: ['design', 'screenshot'],
  },
  {
    id: 'payments',
    label: 'Payments and settlement',
    why: 'A money path that is never exercised end to end is a claim, not a feature.',
    terms: ['stripe', 'x402', 'checkout session', 'usdc', 'payment intent', 'take a payment'],
    catalog: ['payment', 'wallet', 'invoice'],
  },
  {
    id: 'knowledge-base',
    label: 'A knowledge base outside the repo',
    why: 'Decisions recorded somewhere the agent cannot read get re-litigated every session.',
    terms: ['Notion', 'notion.so', 'obsidian vault', 'the wiki', 'wiki page', 'knowledge base'],
    catalog: ['wiki', 'memory', 'docs vault'],
  },
  {
    id: 'comms',
    label: 'Messaging and calendar',
    why: 'Output with no delivery surface is why thirty-five routines in this vault are still switched off.',
    terms: ['Slack', 'slack channel', 'slack message', 'post to slack', 'send an email',
      'gmail', 'google calendar', 'calendar invite', 'telegram'],
    catalog: ['email', 'calendar', 'messaging'],
  },
  {
    id: 'data-files',
    label: 'Spreadsheets, PDFs and tabular data',
    why: 'Tabular and binary formats are where a text-only agent silently reads nothing.',
    terms: ['spreadsheet', 'google sheet', 'the csv', 'a pdf', 'xlsx', 'the pdf'],
    catalog: ['csv', 'excel', 'sheets', 'pdf'],
  },
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A term ruled OUT rather than asked for.
 *
 * "I would like to avoid supabase" and "no Postgres, that is enterprise
 * weight" both mention a capability in order to reject it. Counting those as
 * demand inverts the signal completely, and both appear in the corpus this was
 * measured against.
 */
const NEGATED = /\b(no|not|never|avoid|avoiding|without|instead of|rather than)\s+(\w+\s+){0,2}$/i;

/**
 * First term in `terms` that appears in `text`, or null.
 *
 * Three things are going on here and each one came from a hand-check of 94 real
 * matches, not from imagination:
 *
 *   BOUNDARIES are applied only where the term's own edge is a word character,
 *   so a term ending in a space (`the pr `) keeps the space that makes it
 *   specific instead of having it eaten by a `\b`.
 *
 *   CASE MATTERS when the term contains a capital. `Slack` and `Notion` are
 *   product names that collide with ordinary English words, and the corpus had
 *   five such collisions: "64px slack at 390px", "the 180px of footer slack",
 *   "advanceMatch has no notion of a round winner". A capital letter is the
 *   cheapest discriminator that exists and it costs nothing to honour. Same
 *   trick the injection scanner uses on `steer-from-competitor`.
 *
 *   A PATH IS NOT AN ASK. `.obsidian/` in an exclusion list and
 *   `logs/queue/.runner.lock` are filesystem paths. A term glued to a dot on
 *   its left or a slash on its right is part of one.
 */
export function termHit(text, terms) {
  const raw = String(text ?? '');
  for (const t of terms) {
    const cased = /[A-Z]/.test(t);
    const hay = cased ? raw : raw.toLowerCase();
    const lead = /^\w/.test(t) ? '\\b' : '';
    const tail = /\w$/.test(t) ? '\\b' : '';
    const re = new RegExp(lead + escape(t) + tail, 'g');
    let m;
    while ((m = re.exec(hay)) !== null) {
      const before = hay.slice(Math.max(0, m.index - 40), m.index);
      const after = hay.slice(m.index + t.length, m.index + t.length + 1);
      // A LEADING DOT means a dotfile (` .obsidian/`). A dot with a word
      // character in front of it is a hostname (`docs.mcp.cloudflare.com`), and
      // rejecting those threw away the best-graded candidate in the first real
      // run: an A-grade Cloudflare docs server, invisible because of a dot.
      if (/(^|[^\w])\.$/.test(before) || after === '/') continue;
      if (NEGATED.test(before)) continue;
      return t;
    }
  }
  return null;
}

/** Where a harness keeps its transcripts, and whether this one can be read. */
export function historyDirFor(root, { home = homedir() } = {}) {
  // Claude Code encodes the project path by replacing every non-alphanumeric
  // character with a dash. `C:\Users\x\Vault` becomes `C--Users-x-Vault`.
  const slug = String(root).replace(/[^A-Za-z0-9]/g, '-');
  const dir = join(home, '.claude', 'projects', slug);
  return existsSync(dir) ? dir : null;
}

const NOISE = [
  '<system-reminder>', '<local-command-stdout>', '<command-name>',
  'Caveat: The messages below', 'tool_use_id',
  // The harness writes this into a `user` record when somebody presses stop.
  // It passes every structural filter above because it IS a real user record:
  // not meta, no toolUseResult, no promptSource. Only the content gives it
  // away, which is what this list is for. 6 of 663 prompts on this vault, and
  // they clustered as a repeated "procedure" before being filtered.
  '[Request interrupted by user',
];

/**
 * Is this transcript record something a human actually typed?
 *
 * THIS FUNCTION IS THE WHOLE ACCURACY OF THE COMMAND, and the first version of
 * it was wrong in a way that looked right. Claude Code files a great deal on
 * the `user` channel that no user wrote: every tool result, every hook
 * attachment, every compaction summary, and the full expanded body of a slash
 * command. In this vault that is 1548 of 1656 `user` records. Counting them
 * produced a confident report whose evidence quotes were fragments of skill
 * files, and a build that had never once asked for a thing would be told it
 * asks constantly.
 *
 * The discriminators are structural, not textual, which is why they hold:
 *
 *   toolUseResult   present on a result, absent on a prompt
 *   isMeta          a record the harness filed about itself
 *   isCompactSummary  a summary Claude wrote, attributed to the user channel
 *   text beginning `# /`   a slash command's expanded body, not the ask
 *
 * The slash-command case is the subtle one. `/session-end` IS a real user
 * action, but what lands in the transcript is the skill's entire markdown body,
 * so counting it measures the skill file rather than the person.
 */
export function isRealPrompt(rec) {
  if (rec.type !== 'user' || rec.isSidechain) return false;
  if (rec.toolUseResult !== undefined) return false;
  if (rec.isMeta || rec.isCompactSummary || rec.isVisibleInTranscriptOnly) return false;
  // A SECOND CLASS OF THING NOBODY TYPED, found 2026-09-21.
  //
  // The filters above were written against the transcript shape of the time and
  // still hold. Since then the harness gained background tasks, and a task
  // notification arrives as an ordinary `user` record: no toolUseResult, not
  // meta, not a compact summary. Its CONTENT is harness text, so nothing above
  // sees it.
  //
  // Measured across this vault's eleven transcript directories: 244 of 874
  // surviving prompts, 27.9%, were task notifications. They inflated needs the
  // same way tool results once did, worst where the corpus is thinnest:
  // payments 8 to 2, observability 3 to 1, browser-automation 25 to 11.
  //
  // `promptSource` is the structural discriminator, which is why this belongs
  // here rather than in the textual NOISE list below. A notification is
  // 'system'; a person's prompt is 'typed', 'suggestion_accepted' or 'queued'.
  // Absent means an older record from before the field existed, and those are
  // KEPT: rejecting them would throw away the whole historical corpus to catch
  // a class that did not exist when they were written.
  if (rec.promptSource === 'system') return false;
  return true;
}

/**
 * User prompts from a Claude Code transcript directory.
 *
 * Deduplicated by text. A resumed session copies the whole prior transcript
 * into a new file, so without this the same sentence is counted once per
 * resume, and the busiest needs are simply the ones from the most-resumed
 * session.
 */
/**
 * `dedupe` defaults to true because `needs` is counting WHICH capabilities a
 * build asks for, and the same request pasted twice is not two wants.
 *
 * `repeats` passes false because it is measuring how often the same procedure
 * is retyped, and a collapsed duplicate is a deleted observation.
 *
 * Measured before relying on it, and the number is small: across 12 transcript
 * directories this option changes 657 prompts to 663. Six. People do not
 * retype a prompt verbatim, they retype the same PROCEDURE in different words,
 * which is why `repeats` cannot lean on exact matching and has to cluster.
 * The option is still correct (a collapsed repeat is a lost observation, and a
 * copy-paste heavy corpus would show more) but it is not where the signal is.
 */
export function readPrompts(dir, { limit = 4000, minChars = 12, dedupe = true, fs = { readdirSync, readFileSync, statSync } } = {}) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f));

  const out = [];
  const seen = new Set();
  for (const file of files) {
    let body;
    try { body = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of body.split('\n')) {
      if (!line.startsWith('{')) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (!isRealPrompt(rec)) continue;
      const content = rec.message?.content;
      let text = null;
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        const parts = content.filter((p) => p?.type === 'text').map((p) => p.text);
        if (parts.length) text = parts.join('\n');
      }
      if (!text || text.length < minChars) continue;
      if (text.trimStart().startsWith('# /')) continue;
      if (NOISE.some((n) => text.includes(n))) continue;
      const key = text.trim().slice(0, 400);
      if (dedupe && seen.has(key)) continue;
      seen.add(key);
      out.push({ text, session: rec.sessionId ?? null });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Count, per need, how often this build has asked for it. */
export function signalsFrom(prompts) {
  const rows = NEEDS.map((n) => ({
    id: n.id, label: n.label, why: n.why, hits: 0, sessions: new Set(), terms: new Set(), examples: [],
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const p of prompts) {
    for (const need of NEEDS) {
      const term = termHit(p.text, need.terms);
      if (!term) continue;
      const row = byId.get(need.id);
      row.hits += 1;
      row.terms.add(term);
      if (p.session) row.sessions.add(p.session);
      // Two examples is enough to check a match by eye and few enough that the
      // output stays readable. The excerpt is the operator's own words.
      if (row.examples.length < 2) row.examples.push(excerpt(p.text, term));
    }
  }

  return rows
    // `sessions` stays a COUNT because renderNeeds and every existing caller
    // read it as one. `sessionIds` is added alongside rather than replacing it,
    // because attribution needs to know WHICH sessions a need appeared in and
    // that information was being thrown away here.
    .map((r) => ({ ...r, sessions: r.sessions.size, sessionIds: [...r.sessions], terms: [...r.terms] }))
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id));
}

/**
 * Tokens already processed, divided evenly between the needs that shared a session.
 *
 * WHAT THIS NUMBER IS, stated exactly, because the label is the only thing
 * standing between it and a claim nobody measured:
 *
 * It is every token the session moved. Input, output, cache creation and cache
 * read, summed. In this vault that total is 98.1% cache reads, which are the
 * cheap part, so this tracks how much context a session carried rather than
 * what it cost. It is called "tokens processed" everywhere it surfaces and it
 * is never called spend.
 *
 * IT IS NOT MONEY and this file must never turn it into money. The transcripts
 * carry no cost field at all, so dollars would need a price table, and CodeBurn
 * already owns that math against these same files. A second price table here
 * would drift from that one the first time a rate changed, which is the failure
 * invariant 2 forbids for grade math, pointed at a different number.
 * `cost_usd` therefore exists in the shape and is permanently null.
 *
 * THE DIVISION IS SHOWN, NEVER HIDDEN. A session that matched three needs gives
 * each a third, and `spendNote` says so in words. An even split is defensible
 * only while it is legible: the same figure printed bare would be claiming a
 * measurement of one need that was never taken.
 *
 * Invariant 28 is what makes the denominator trustworthy. The session ids come
 * from prompts `isRealPrompt()` already filtered, so tool results, hook
 * attachments and expanded slash-command bodies are not in the count. Were they,
 * every need would inflate roughly threefold and so would its share.
 */
export function attributeSpend(needs, sessionCosts) {
  // How many needs each session is split between. Computed across the whole
  // set, not per need, because the denominator is a property of the session.
  const perSession = new Map();
  for (const n of needs) {
    for (const s of n.sessionIds ?? []) perSession.set(s, (perSession.get(s) ?? 0) + 1);
  }

  return needs.map((n) => {
    const ids = n.sessionIds ?? [];
    if (!sessionCosts || !ids.length) {
      return { ...n, spendTokens: null, spendNote: 'tokens not attributed' };
    }

    let total = 0;
    let attributed = 0;
    let denomSum = 0;
    let unknown = false;
    for (const id of ids) {
      const k = perSession.get(id) || 1;
      denomSum += k;
      const rec = sessionCosts.get(id);
      // A MISSING ENTRY IS NULL, A ZERO ENTRY IS ZERO. A session the cost map
      // never saw is unknown; a session it saw and measured at zero is a
      // discovered zero. Collapsing the two would let an unreadable transcript
      // quietly read as a free one.
      if (rec == null || typeof rec.tokens !== 'number') { unknown = true; continue; }
      total += rec.tokens / k;
      attributed += 1;
    }

    if (unknown) {
      // One unattributable session poisons the total rather than being skipped.
      // A sum over the sessions that happened to be readable is a smaller number
      // presented as a complete one.
      return { ...n, spendTokens: null, spendNote: 'tokens not attributed' };
    }

    const avgDenom = ids.length ? Math.round((denomSum / ids.length) * 10) / 10 : 1;
    return {
      ...n,
      spendTokens: Math.round(total),
      spendNote: `tokens shared across ${avgDenom} matched needs in ${attributed} sessions`,
    };
  });
}

/** A window around the matched term, so the reader can judge the match. */
export function excerpt(text, term, width = 90) {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  const from = Math.max(0, at - Math.floor((width - term.length) / 2));
  const cut = text.slice(from, from + width).replace(/\s+/g, ' ').trim();
  return (from > 0 ? '\u2026' : '') + cut + (from + width < text.length ? '\u2026' : '');
}

/**
 * Which needs this build already covers, and what covers them.
 *
 * Matched against the servers' own names, urls and the MCP tool names the
 * agents hold, because that is the only capability text a local inventory has.
 */
export function coveredBy(inv) {
  const text = [];
  for (const s of inv.mcpServers ?? []) {
    // `tools` is not always an array. Different inventory sources populate it
    // differently, and spreading a non-array threw `is not iterable` from
    // inside a read-only command, which is the last place a crash belongs.
    const tools = Array.isArray(s.tools) ? s.tools
      : s.tools && typeof s.tools === 'object' ? Object.keys(s.tools)
      : [];
    text.push([s.name, s.url, ...tools].filter(Boolean).join(' '));
  }
  for (const a of inv.allowlisted ?? []) text.push([a.name, a.url].filter(Boolean).join(' '));

  const covered = new Map();
  for (const need of NEEDS) {
    for (const t of text) {
      const term = termHit(t, need.terms);
      if (term) { covered.set(need.id, { by: t.trim().slice(0, 80), term }); break; }
    }
  }
  return covered;
}

/**
 * Capability text a candidate published about itself. Never our words.
 *
 * URLS INSIDE THE DESCRIPTION ARE STRIPPED, and `homepage` is not read at all.
 * Nearly every MCP server on a public registry links its source on github.com,
 * so matching on that link makes a weather server and a paper search look like
 * answers to "I need pull requests". Both showed up in the first real run.
 *
 * The server's OWN url survives, because `docs.mcp.cloudflare.com` is a genuine
 * statement about what the thing does rather than an incidental link.
 */
export function candidateText(c) {
  const described = String(c.description ?? '').replace(/https?:\/\/\S+/g, ' ');
  return [c.name, c.server_name, c.id, c.server_url, described,
    ...(Array.isArray(c.tool_names) ? c.tool_names : [])]
    .filter(Boolean).join(' ');
}

/**
 * Candidates whose own published text claims a need.
 *
 * `blocked` outranks everything: a candidate that hard-failed or graded F is
 * still listed, because suppressing it would make a fixable gap look like an
 * empty one, but it can never be the thing suggested.
 */
export function rankCandidates(need, candidates, installed = new Set()) {
  const out = [];
  // A PRODUCT NAME IS NOT PROSE, and the two need different thresholds.
  //
  // The prompt side has to be strict: `search` would match "search the
  // codebase". A candidate called `exa-search-server` is not ambiguous in the
  // same way, because nobody names a server after an incidental verb. Holding
  // both sides to the prose threshold made the graded half of the catalogue
  // match WORST: the A-graded Exa and Astro Docs servers were invisible for
  // exactly the needs they serve, while ungraded registry rows with long
  // marketing descriptions surfaced instead. That is backwards, and the graded
  // rows are the ones worth anything.
  const terms = [...need.terms, ...(need.catalog ?? [])];
  for (const c of candidates) {
    if (c.is_fixture || c.self_graded) continue;
    const term = termHit(candidateText(c), terms);
    if (!term) continue;
    const url = c.server_url ?? c.gradeable_endpoint ?? c.registry_endpoint ?? c.homepage ?? null;
    const blocked = Boolean(c.hard_fail) || c.grade === 'F';
    out.push({
      name: c.server_name ?? c.name ?? c.id ?? url,
      url,
      grade: c.grade ?? null,
      score: typeof c.score === 'number' ? c.score : null,
      hard_fail: c.hard_fail ?? null,
      graded: c.grade != null,
      source: c.source ?? (c.audit_id ? 'feed' : 'candidates'),
      transcripts: c.transcripts ?? null,
      matched: term,
      verdict: installed.has(url) ? 'already-installed'
        : blocked ? 'blocked'
        : c.grade == null ? 'ungraded'
        : 'worth-measuring',
    });
  }
  // Graded and unblocked first, then by score, then by whether anything is known.
  const rank = { 'worth-measuring': 0, ungraded: 1, blocked: 2, 'already-installed': 3 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.score ?? -1) - (a.score ?? -1));
}

/** Kinds that are scaffolding: the part of a harness that can be handed over. */
const TRAVELS = new Set(['agent', 'command', 'skill', 'routine', 'persona']);

/** Paths that hold accumulation, whatever kind the thing in them claims to be. */
const STAYS_PATH = /(^|[\\/])(memory|lessons|evidence|clients)([\\/]|$)/i;

/**
 * Does this unit travel into someone else's build, or stay here?
 *
 * The cut is `positioning.md`, "engine and skills travel, lessons and data
 * never". Scaffolding is what a client can be handed. The accumulation, the
 * lesson corpus, the memory, the evidence bundles and anything under a client
 * directory, is the part that cannot leave without taking somebody's IP with it.
 *
 * FAIL CLOSED, and this is the first commit of the function rather than a
 * fallback bolted on later. Anything unrecognised STAYS. The reasoning is
 * invariant 27's: a plugin update replaces the plugin directory wholesale, so
 * the safe default has to be the one where a thing nobody classified is left
 * behind. The failure mode of the safe default is a missing capability. The
 * failure mode of the unsafe one is a leak, and only one of those is noticed.
 *
 * PATH BEATS KIND, deliberately. A skill sitting in `clients/laguna/` is client
 * material that happens to be shaped like a skill. Trusting the declared kind
 * over its location is how accumulation gets reclassified as scaffolding by
 * whoever files it in the wrong place.
 *
 * No cache, no stored state. It reads its two arguments and nothing else, so a
 * unit that moves cannot keep an old verdict.
 */
export function classifyUnit(kind, filePath) {
  if (STAYS_PATH.test(String(filePath ?? ''))) return 'stays';
  return TRAVELS.has(String(kind ?? '').toLowerCase()) ? 'travels' : 'stays';
}

/**
 * What is installed that this build's own history never asked for.
 *
 * `doctor` reads what a build HAS and `needs` reads what it KEEPS ASKING FOR.
 * The gap between them runs both ways, and only one direction was reported. A
 * server nobody has needed in four thousand prompts costs context on every turn
 * it is listed, and two servers answering the same need cost it twice.
 *
 * REPORTS, NEVER RECOMMENDS REMOVAL. This is invariant 29's restraint pointed at
 * the other end of the telescope: a unit that matched nothing may be the one
 * that quietly does the thing nobody has had to ask about. The output names what
 * is unmatched and leaves the conclusion to a person.
 *
 * Pure. Units are passed in, so there is no filesystem read here and no way for
 * this to see anything the caller did not hand it.
 */
export function deadWeightIn(inventory, signals) {
  const units = [
    ...(inventory?.mcpServers ?? []).map((s) => ({ ...s, kind: s.kind ?? 'mcp-server' })),
    ...(inventory?.allowlisted ?? []).map((a) => ({ ...a, kind: a.kind ?? 'allowlisted' })),
  ];
  // Only needs this build actually asked for. Matching against the whole
  // taxonomy would call a server "used" for a capability nobody ever wanted.
  const active = NEEDS.filter((n) => (signals ?? []).some((s) => s.id === n.id));

  const unused = [];
  const byNeed = new Map();
  for (const u of units) {
    const text = candidateText(u);
    let matchedAny = false;
    for (const need of active) {
      if (!termHit(text, [...need.terms, ...(need.catalog ?? [])])) continue;
      matchedAny = true;
      if (!byNeed.has(need.id)) byNeed.set(need.id, []);
      byNeed.get(need.id).push(u.name ?? u.url ?? u.id ?? '(unnamed)');
    }
    if (!matchedAny) {
      unused.push({
        name: u.name ?? u.url ?? u.id ?? '(unnamed)',
        kind: u.kind,
        classifiedAs: classifyUnit(u.kind, u.url ?? u.path ?? ''),
      });
    }
  }

  // One row per pair, not per shared need. Two servers that overlap on three
  // needs are one duplication to resolve, not three findings to read.
  const seen = new Set();
  const overlapping = [];
  for (const [needId, names] of byNeed) {
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = [names[i], names[j]].sort().join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        overlapping.push({ needId, names: [names[i], names[j]] });
      }
    }
  }

  // `unitsChecked` exists so a surface can tell two very different facts apart:
  // everything installed is being asked for, and nothing is installed at all.
  // Both produce an empty `unused` list, and only one of them is good news.
  // The vault this was built against reports zero configured MCP servers with
  // coverage "read", which is the second case wearing the first one's output.
  return { unused, overlapping, unitsChecked: units.length };
}

/**
 * The whole report. Pure: every input is passed in, so this is testable with no
 * network, no filesystem and no model.
 */
export function suggest({ prompts, inventory, candidates = [], installed = new Set(), sessionCosts = null }) {
  const raw = signalsFrom(prompts);
  const covered = coveredBy(inventory ?? {});
  // Attribution runs on the whole signal set before anything is filtered, so a
  // session's denominator counts every need it matched rather than only the
  // ones that survived to the end of this function.
  const signals = attributeSpend(raw, sessionCosts);

  const needs = signals.map((s) => {
    const cover = covered.get(s.id) ?? null;
    const matches = cover ? [] : rankCandidates(NEEDS.find((n) => n.id === s.id), candidates, installed);
    return {
      ...s,
      covered: Boolean(cover),
      covered_by: cover?.by ?? null,
      candidates: matches,
      // The line that must never be dropped. A need nothing graded covers is a
      // gap in the feed, and saying so is more useful than saying nothing.
      gap: !cover && matches.length === 0,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    prompts_read: prompts.length,
    needs,
    unmet: needs.filter((n) => !n.covered).length,
    gaps: needs.filter((n) => n.gap).length,
    dead_weight: deadWeightIn(inventory ?? {}, raw),
    // Declared absent rather than omitted. A reader who goes looking for money
    // should find the answer "not derived here", not silence. See attributeSpend.
    cost_usd: null,
  };
}

export function renderNeeds(r, { historyNote = null } = {}) {
  const L = [];
  L.push('');
  L.push(`doorman needs \u2014 ${r.prompts_read} prompts read from this build\u2019s own history`);
  if (historyNote) L.push(`  ${historyNote}`);
  L.push('');

  if (!r.needs.length) {
    L.push('  Nothing in the taxonomy matched. That is a real answer: either this');
    L.push('  build has not asked for any of the twelve capabilities doorman knows');
    L.push('  how to look for, or the history it could read is too short to tell.');
    return L.join('\n');
  }

  for (const n of r.needs) {
    const head = n.covered ? 'COVERED' : n.gap ? 'GAP' : 'UNMET';
    L.push(`${head.padEnd(8)} ${n.label}`);
    L.push(`         ${n.hits} prompts across ${n.sessions} sessions  \u00b7  matched ${n.terms.map((t) => `"${t}"`).join(', ')}`);
    for (const e of n.examples) L.push(`         > ${e}`);
    if (n.covered) {
      L.push(`         already covered by: ${n.covered_by}`);
    } else if (n.gap) {
      L.push('         nothing graded covers this. The feed has the gap, not your build.');
    } else {
      for (const c of n.candidates.slice(0, 3)) {
        const g = c.graded ? `${c.grade}${c.score != null ? ` (${c.score})` : ''}` : 'ungraded';
        L.push(`         ${c.verdict.padEnd(16)} ${c.name}  [${g}]  matched "${c.matched}"`);
        if (c.hard_fail) L.push(`                          hard fail: ${c.hard_fail}`);
        if (c.url) L.push(`                          ${c.url}`);
      }
    }
    L.push('');
  }

  L.push(`${r.unmet} unmet, ${r.gaps} of them with nothing graded to offer.`);
  L.push('');
  L.push('What this is: your own prompts, counted, against capability text those');
  L.push('candidates published about themselves. Nothing here was driven, so');
  L.push('nothing here is a claim that a server works. `worth-measuring` means');
  L.push('exactly that \u2014 run `doorman eval` with your key and find out.');
  return L.join('\n');
}
