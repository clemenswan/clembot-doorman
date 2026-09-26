/**
 * Procedures this build keeps retyping.
 *
 * ── The signal, and why it is different from `needs` ─────────────────────────
 *
 * `needs` asks WHAT a build reaches for, by counting capability keywords, and
 * answers with MCP servers from the graded feed. That only ever finds gaps a
 * product can fill.
 *
 * Most of what a build is missing is not a product. It is a command, a skill,
 * a subagent, a hook: scaffolding the operator could have written and did not,
 * so they type the procedure again instead. The evidence for that is
 * repetition, and repetition is measurable from the same transcripts with no
 * catalogue, no feed, no model and no network.
 *
 * That independence is the point. `needs` cannot say anything useful to
 * somebody with no MCP servers, and the most developed build we can inspect
 * has 220 scaffold units and zero MCP servers.
 *
 * ── Why clustering and not counting ──────────────────────────────────────────
 *
 * Measured first: across 12 transcript directories, exact deduplication
 * changes 657 prompts to 663. Nobody retypes a prompt verbatim. They retype
 * the same procedure with different arguments, so exact matching finds
 * essentially nothing and the work has to be fuzzy.
 *
 * ── Arguments are noise; the procedure is the signal ─────────────────────────
 *
 * "fix the failing test in auth.mjs" and "fix the failing test in feed.mjs"
 * are ONE procedure run twice. Paths, numbers, urls, hashes and quoted strings
 * are the arguments, and stripping them is what lets the shape show through.
 * Getting this wrong in either direction is the main way this module could
 * lie: strip too little and every run looks unique, strip too much and
 * everything looks the same.
 *
 * ── Common words are removed by measurement, not by a word list ──────────────
 *
 * A hardcoded English stopword list would be tuned to this corpus and would
 * not travel to a stranger's. Document frequency is computed from whatever
 * corpus is in front of it, so "the" and "please" fall out on their own, and
 * so does whatever house vocabulary a different build happens to repeat.
 *
 * ── No score, and one honest distinction ─────────────────────────────────────
 *
 * A cluster inside ONE session is usually a retry loop: the same thing asked
 * three ways because the first two did not work. That is a debugging story,
 * not a missing command. A cluster ACROSS sessions, weeks apart, is a
 * procedure that has outlived its context and never got written down.
 *
 * Those are reported separately and never summed. Merging them would inflate
 * every figure with exactly the cases that do not support the conclusion.
 *
 * ── A known limit, seen on the first real corpus ─────────────────────────────
 *
 * Greedy seeding can split ONE procedure across two clusters when an early
 * prompt seeds a second, slightly different centre. On this vault the
 * commit-and-deploy procedure came out as a cluster of 7 and a cluster of 3,
 * and only the smaller one matched the `deploy` command by name, so the same
 * behaviour is reported once as covered and once as a gap.
 *
 * That is under-merging, which is the safe direction: it shows a real
 * procedure twice rather than inventing one that nobody ran. Fixing it means
 * a merge pass over cluster cores, which is worth doing when a corpus makes
 * the cost visible, not before.
 */

/** Twice is a coincidence. */
export const MIN_CLUSTER = 3;

/** A token in more than this share of prompts carries no distinguishing signal. */
export const COMMON_TOKEN_RATIO = 0.30;

/**
 * ...but a share is meaningless on a handful of prompts.
 *
 * With three prompts, "more than 30%" means "in two of them", so the cut
 * deleted every token the three had in common and nothing could ever cluster.
 * A word cannot be shown to be boilerplate from three observations. Below this
 * many sightings a token is never called common, whatever its ratio.
 *
 * This matters most for the audience least served today: somebody who just
 * installed this and has a short history.
 */
export const MIN_SIGHTINGS_TO_BE_COMMON = 5;

/** Jaccard overlap two prompts must reach to be called the same procedure. */
export const DEFAULT_THRESHOLD = 0.55;

/** Shorter than this and there is not enough left to compare after stripping. */
export const MIN_TOKENS = 4;

/**
 * A token in fewer than this share of prompts is distinctive enough that
 * matching it against a unit's name means something.
 *
 * Measured, after the first run claimed skill `gsap-core` covered a cluster on
 * the strength of the words "for", "use" and "user". Three shared tokens are
 * not evidence when all three are common; one shared RARE token is. The
 * document-frequency cut at 0.30 is for clustering and is far too generous
 * here, so coverage gets its own, stricter bar.
 */
export const RARE_RATIO = 0.05;

/**
 * Strip the arguments, keep the verb.
 *
 * Order matters: urls before paths (a url contains slashes), fenced code
 * before everything (it is all arguments), quoted strings before punctuation
 * (the quotes are the delimiter that identifies them).
 */
export function normalise(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')           // fenced code: entirely argument
    .replace(/`[^`]*`/g, ' ')                  // inline code
    .replace(/https?:\/\/\S+/gi, ' ')          // urls
    .replace(/["'][^"']{2,}["']/g, ' ')        // quoted literals
    // ANY token carrying a path separator is a path. The earlier rule only
    // caught paths anchored at `/`, `./` or `~/`, so a relative `src/auth.mjs`
    // lost its filename to the extension rule below and left `src` behind as
    // a "distinctive" token. Two runs of one procedure then differed by their
    // directory, which is exactly the argument this is meant to remove.
    .replace(/\S*[/\\]\S*/g, ' ')             // paths, any shape, any platform
    .replace(/\b[\w.-]+\.(mjs|js|ts|tsx|jsx|json|md|py|sh|css|html|yaml|yml|toml|sql)\b/gi, ' ')
    // Hashes must go BEFORE the symbol strip, and only because hex is letters:
    // `a1b2c3d4e5f` would otherwise lose its digits and leave `abcdef` behind
    // as a perfectly plausible looking word.
    .replace(/\b[0-9a-f]{7,}\b/gi, ' ')        // hashes and ids
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')                 // punctuation, leftover symbols
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens worth comparing. Two characters and under are never distinctive. */
export function tokenise(text) {
  return normalise(text).split(' ').filter((w) => w.length >= 3);
}

/**
 * Document frequency across the corpus, used to drop words that cannot
 * separate one prompt from another.
 */
export function documentFrequency(tokenSets) {
  const df = new Map();
  for (const set of tokenSets) {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}

/** |A n B| / |A u B|. Zero when either side is empty, never NaN. */
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Group prompts that describe the same procedure.
 *
 * Greedy single-pass assignment against each cluster's SEED, not against a
 * drifting centroid. A centroid that absorbs every member slowly widens until
 * unrelated prompts clear the threshold, and the resulting cluster cannot be
 * explained to the person it is shown to. Comparing to the seed keeps every
 * member within one threshold of one concrete prompt.
 *
 * `prompts` is `[{ text, session }]`, the shape `readPrompts` returns.
 */
export function clusterPrompts(prompts, { threshold = DEFAULT_THRESHOLD, minCluster = MIN_CLUSTER } = {}) {
  const rows = prompts.map((p, i) => ({
    i,
    text: typeof p === 'string' ? p : p.text,
    session: typeof p === 'string' ? null : (p.session ?? null),
    tokens: new Set(tokenise(typeof p === 'string' ? p : p.text)),
  }));

  const df = documentFrequency(rows.map((r) => r.tokens));
  const n = rows.length || 1;
  const tooCommon = new Set(
    [...df.entries()]
      .filter(([, c]) => c >= MIN_SIGHTINGS_TO_BE_COMMON && c / n > COMMON_TOKEN_RATIO)
      .map(([t]) => t),
  );

  // Distinctive tokens only. Done after df so the cut adapts to the corpus.
  for (const r of rows) {
    r.tokens = new Set([...r.tokens].filter((t) => !tooCommon.has(t)));
  }

  const usable = rows.filter((r) => r.tokens.size >= MIN_TOKENS);
  const clusters = [];

  for (const r of usable) {
    let best = null;
    let bestScore = 0;
    for (const c of clusters) {
      const s = jaccard(r.tokens, c.seed.tokens);
      if (s >= threshold && s > bestScore) { best = c; bestScore = s; }
    }
    if (best) best.members.push(r);
    else clusters.push({ seed: r, members: [r] });
  }

  return clusters
    .filter((c) => c.members.length >= minCluster)
    .map((c) => shapeCluster(c, df, n))
    .sort((a, b) => b.sessions - a.sessions || b.size - a.size || a.core.localeCompare(b.core));
}

/**
 * Turn a raw cluster into something reportable.
 *
 * `core` is the tokens EVERY member shares, most distinctive first, which is
 * the closest thing to a name the data can supply on its own. Naming it
 * anything else would be inventing a label for somebody else's work.
 */
function shapeCluster(c, df, n) {
  let shared = new Set(c.members[0].tokens);
  for (const m of c.members.slice(1)) {
    shared = new Set([...shared].filter((t) => m.tokens.has(t)));
  }
  const core = [...shared].sort((a, b) => (df.get(a) ?? 0) - (df.get(b) ?? 0));
  const sessions = new Set(c.members.map((m) => m.session).filter(Boolean));

  return {
    core: core.slice(0, 6).join(' '),
    coreTokens: core,
    // Carried so coverage matching can weigh a token instead of counting it.
    coreDf: Object.fromEntries(core.map((t) => [t, (df.get(t) ?? 0) / n])),
    size: c.members.length,
    // A null session cannot be proven distinct from any other, so it is not
    // counted. Under-reporting spread is the safe direction: it can only move
    // a cluster out of the cross-session bucket, never into it.
    sessions: sessions.size,
    kind: sessions.size >= 2 ? 'cross-session' : 'within-session',
    examples: c.members.slice(0, 3).map((m) => m.text.slice(0, 200)),
  };
}

/**
 * Does an existing unit already cover this cluster?
 *
 * The falsification test for the whole idea: if every repeated procedure maps
 * to a command that already exists, repetition is not evidence of a missing
 * scaffold and this module should be deleted rather than shipped.
 *
 * `units` is `[{ name, kind, description }]`. Matching is on the cluster's own
 * distinctive tokens against the unit's name and description, which is a weak
 * test on purpose: a false "already covered" hides a real finding, so the bar
 * to claim coverage is two distinct token hits rather than one.
 */
export function coveredByUnit(cluster, units) {
  const core = new Set(cluster.coreTokens);
  if (core.size === 0) return null;
  const ratio = cluster.coreDf ?? {};

  let best = null;
  for (const u of units) {
    const nameTokens = tokenise(u.name ?? '');
    if (!nameTokens.length) continue;

    // ROUTE 1: the unit's NAME. A frequency cut is wrong here, and measuring
    // showed why: "deploy" is common in this corpus precisely BECAUSE
    // deploying is a frequent activity, so rarity scoring hid the `/deploy`
    // command behind the very repetition that made it worth finding.
    //
    // What matters instead is how much of the NAME the cluster accounts for.
    // More than half means the cluster is about that unit. Exactly half of a
    // two word name is not enough: a cluster about testing a deployed site
    // shares "test" with the `test-writer` agent and has nothing to do with it.
    const nameHits = [...new Set(nameTokens.filter((t) => core.has(t)))];
    const nameOverlap = nameHits.length / new Set(nameTokens).size;

    // ROUTE 2: the description, where a frequency cut IS right, because a
    // description is prose and its common words carry no signal at all.
    const descHits = [...new Set(tokenise(u.description ?? '').filter((t) => core.has(t)))]
      .filter((t) => (ratio[t] ?? 1) < RARE_RATIO);

    const via = nameOverlap > 0.5 ? 'name' : (descHits.length >= 2 ? 'description' : null);
    if (!via) continue;

    const score = (via === 'name' ? 100 : 0) + nameHits.length * 10 + descHits.length;
    if (!best || score > best.score) {
      best = {
        name: u.name,
        kind: u.kind,
        via,
        score,
        matched: (via === 'name' ? nameHits : descHits).sort(),
      };
    }
  }
  return best;
}

/** Split the honest way: the two kinds are never summed. */
export function summariseClusters(clusters, { prompts = null } = {}) {
  const cross = clusters.filter((c) => c.kind === 'cross-session');
  const within = clusters.filter((c) => c.kind === 'within-session');
  return {
    prompts,
    // NOT `clusters`. The caller spreads this alongside the cluster ARRAY, and
    // a count sharing that key silently replaced the array with a number.
    clusterCount: clusters.length,
    crossSession: cross.length,
    withinSession: within.length,
    promptsInCross: cross.reduce((n, c) => n + c.size, 0),
    promptsInWithin: within.reduce((n, c) => n + c.size, 0),
  };
}
