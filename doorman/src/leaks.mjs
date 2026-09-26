/**
 * What an agent gives away when it shops on your behalf.
 *
 * ── Why this is a separate module from injection.mjs ─────────────────────────
 *
 * `injection.mjs` reads text somebody else wrote and asks whether it is
 * attacking the agent. This reads text WE are about to send and asks what it
 * tells a merchant about us. Same table-plus-loop shape on purpose, opposite
 * direction, and the two must not share a pattern list: an inbound attack and
 * an outbound disclosure have nothing in common except the scanner.
 *
 * ── The table is NOT validated against a merchant corpus ─────────────────────
 *
 * The injection patterns exist because 23 real servers were graded and one
 * carried a 6,290 character sales script. There is no equivalent evidence here
 * yet. These rows are derived from the signals a merchant COULD price on, not
 * from a merchant observed pricing on them, and the honest use of this module
 * today is to measure whether a real corpus contains any of them at all.
 *
 * `needs.mjs` learned this the expensive way: four candidate term groups were
 * added from a lesson corpus and all four failed against 874 real prompts. So
 * the count this returns is a measurement, never a verdict, and a zero is a
 * real and useful answer.
 *
 * ── Two axes, and only one of them is about severity ─────────────────────────
 *
 * `category` is the shape of the signal. `maskable` is the decision-relevant
 * one, because it says what it would COST to stop leaking:
 *
 *   local     redaction on this machine is sufficient. No relay, no persona,
 *             no third party. A hook can fix it.
 *   relay     the signal is carried by the connection itself, not the
 *             arguments, so nothing local can mask it. Needs an exit identity.
 *   neither   inherent to making the request at all. Cannot be masked, only
 *             not sent.
 *
 * That split is why measurement comes before infrastructure. If a real corpus
 * is dominated by `local`, the cheap product is the whole product.
 *
 * No score. `injection_sniff` scores because a grade consumes it; nothing
 * consumes this yet, and inventing a number for it would be invariant 9 with a
 * friendlier face. Counts and categories, with a denominator.
 */

/** Categories are the brief's five. Do not add a sixth without a reason. */
export const CATEGORIES = ['explicit', 'inferred', 'behavioral', 'historical', 'structural'];

/** What it would take to stop sending it. */
export const MASKABILITY = ['local', 'relay', 'neither'];

/**
 * One RegExp over one string, same constraint the injection table carries.
 * Anything needing cross-field logic or arithmetic is a new function, not a row.
 *
 * Order is preserved so hit order is stable across runs.
 */
export const LEAK_PATTERNS = [
  // ── explicit: the operator stated it in words ──────────────────────────────
  {
    name: 'budget-ceiling',
    category: 'explicit',
    maskable: 'local',
    why: 'A stated ceiling is the price. Nothing above it needs to be offered and nothing below it needs to be.',
    // Requires a currency figure next to the bound. "under the limit" is not a
    // budget and "cheap" is not a number.
    re: /\b(under|below|less than|no more than|up to|max(?:imum)?(?: of)?|budget(?: of| is)?|cheaper than|within)\s*(?:about\s*)?[$£€]\s?\d/i,
  },
  {
    name: 'deadline-stated',
    category: 'explicit',
    maskable: 'local',
    why: 'Urgency removes the option to wait, which is the buyer\'s only leverage.',
    // "before the end of" was dropped: it fires on "before the end of the
    // function" and "before the end of the file", which is ordinary dev prose.
    // A deadline needs a calendar or clock reference, not just the word before.
    re: /\b(by (?:tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|need(?:ed)? (?:it |them )?by|asap|as soon as possible|same[- ]day|overnight (?:ship|deliver)|by (?:close of business|end of day|eod)|by \d{1,2}\s?(?:am|pm))\b/i,
  },
  // `brand-locked` was drafted here and removed before it shipped. The pattern
  // was `(has to be|must be|only want|specifically) <Capitalised>`, which fires
  // on "must be Node 22" and "has to be JSON" in any engineering transcript. A
  // regex cannot tell a brand requirement from a type requirement without
  // knowing the request is commercial, and `needs.mjs` already paid for the
  // lesson that an unchecked bucket is a confident wrong answer waiting for a
  // user. If a real shopping corpus shows brand lock-in matters, it comes back
  // as a row that was measured rather than guessed.

  // ── inferred: derivable without being stated ───────────────────────────────
  {
    name: 'postal-code',
    category: 'inferred',
    maskable: 'local',
    why: 'Postal code is the standard geographic price-discrimination key.',
    // Anchored on purpose. A bare five digit number is a version, a port, a
    // row count and a year range far more often than it is a ZIP.
    re: /\b(zip|zipcode|postcode|postal code|ship(?:ping)? to|deliver(?:y)? to|address)\b[^.]{0,20}\b\d{5}(?:-\d{4})?\b/i,
  },
  {
    name: 'locality-stated',
    category: 'inferred',
    maskable: 'local',
    why: 'A city narrows the segment even without a postal code.',
    // Bare "I'm in <Capitalised>" was dropped for the same reason as
    // brand-locked: "I'm in Phase 2", "I am in Chrome", "I'm in JavaScript".
    // Only the shipping and delivery forms read commercially on their own.
    re: /\b(ship(?:ping)? to|deliver(?:ing)? to|delivery address|located in|collect(?:ion)? from)\s+[A-Z][a-zA-Z]{2,}/,
  },
  {
    name: 'device-or-carrier',
    category: 'inferred',
    maskable: 'local',
    why: 'Device class has been used as a willingness-to-pay proxy for two decades.',
    re: /\b(on my (?:iphone|ipad|mac|macbook|android|pixel)|verizon|t-mobile|vodafone|o2|at&t)\b/i,
  },

  // ── behavioral: reveals the negotiating position ───────────────────────────
  {
    name: 'walk-away-threshold',
    category: 'behavioral',
    maskable: 'local',
    why: 'The reservation price. Disclosing it ends the negotiation at that number.',
    re: /\b(walk away|i(?:'d| would) pay (?:up to|no more than)|my limit is|not (?:a penny|a cent) (?:more|over)|if it(?:'s| is) (?:more|over) than)\b/i,
  },
  {
    name: 'impatience-signalled',
    category: 'behavioral',
    maskable: 'local',
    why: 'Patience is leverage and does not need masking. Its absence does.',
    re: /\b(just (?:buy|book|order|get) it|don(?:'|)t care (?:about|what) (?:the )?(?:price|cost|it costs)|whatever it costs|price is(?:n(?:'|)t| not) (?:an issue|important)|money is no object)\b/i,
  },
  {
    name: 'prior-rejection',
    category: 'behavioral',
    maskable: 'local',
    why: 'Saying an earlier quote was too high reveals the shape of the curve you are on.',
    re: /\b(too expensive|that(?:'s| is) too (?:much|high)|cheaper option|any cheaper|better price than)\b/i,
  },

  // ── historical: ties this request to a known buyer ─────────────────────────
  {
    name: 'loyalty-identity',
    category: 'historical',
    maskable: 'relay',
    why: 'A logged-in identity joins this quote to every prior one. Local redaction cannot help once the session is authenticated.',
    re: /\b(my (?:account|membership|rewards)|member (?:number|id)|loyalty (?:number|card|id)|frequent (?:flyer|flier)|logged in (?:as|to))\b/i,
  },
  {
    name: 'prior-purchase-reference',
    category: 'historical',
    maskable: 'local',
    why: 'A repeat purchase is a revealed preference and a demonstrated willingness to pay the old price.',
    // Bare `re-?order` was measured and removed. It fired on "Reorder the MCP
    // block" and "worth doing after any reorder": in engineering prose reorder
    // means rearrange, and that is the dominant sense by a wide margin. The
    // purchase sense always carries a possessive or a comparison, so require
    // one.
    re: /\b(same as (?:my )?last (?:time|order)|i bought (?:this|it|one|them) (?:before|last)|my (?:last|previous|usual) order|order (?:the same|it) again)\b/i,
  },

  // ── structural: the agent leaks it, not the operator ───────────────────────
  {
    name: 'affiliate-parameter',
    category: 'structural',
    maskable: 'local',
    why: 'A referral parameter on an outbound quote means somebody is paid for the click. That is adversary (b), and nothing else in this codebase can see it.',
    re: /[?&](ref|referrer|aff|affiliate|affiliate_id|partner_id|utm_source|utm_campaign|utm_medium|tag|clickid|irclickid|cjevent)=[^&\s]+/i,
  },
  {
    name: 'affiliate-field-name',
    category: 'structural',
    maskable: 'local',
    // Found by mutation-checking, not by reading. Removing the object-key scan
    // from `scanToolInput` broke no test, because the only affiliate row
    // required a `?` or `&` and so could never match a bare field name. That
    // made the key scan dead code AND left a real shape undetected: a POST body
    // of {"affiliate_id": "abc"} carries the kickback in the key, with a value
    // that looks like nothing. A query string is not the only way to get paid.
    why: 'A request body field named for a referral program is a kickback with no query string to give it away.',
    re: /^(aff(?:iliate)?(?:[_-]?id)?|partner[_-]?id|referr?al[_-]?(?:id|code)|utm[_-]\w+|clickid|irclickid|cjevent)$/i,
  },
  {
    name: 'agent-framework-fingerprint',
    category: 'structural',
    maskable: 'relay',
    why: 'Announcing that the buyer is an agent invites agent-specific pricing. It rides on headers a hook cannot reach.',
    // Measured and tightened. The bare product names fired 10 times on one
    // engineering corpus and every hit was documentation prose, a CLI flag
    // (`--agent claude-code`), or a schema URL. A framework's name appearing in
    // text is not a disclosure; a HEADER carrying it is. So the header context
    // is now required rather than optional, which is the difference between
    // naming a tool and identifying yourself to a server.
    re: /\b(user[- ]?agent|x-agent|x-client|client[- ]?id)\b\s*[:=]\s*["']?[^"'\s]{0,40}\b(claude|claude-code|langchain|autogpt|crewai|openai|anthropic|agent|bot)\b/i,
  },
  {
    name: 'stated-agency',
    category: 'structural',
    maskable: 'neither',
    why: 'Telling a merchant you are an automated buyer cannot be masked by a relay, only not said.',
    re: /\b(i(?:'m| am) an? (?:ai|agent|bot|assistant)|on behalf of my (?:user|human|owner)|acting as an agent for)\b/i,
  },
];

/** Split once, at module load, the way the injection table does. */
export const BY_CATEGORY = Object.fromEntries(
  CATEGORIES.map((c) => [c, LEAK_PATTERNS.filter((p) => p.category === c)]),
);

/** Verbatim from injection.mjs. An accusation that cannot be checked is not evidence. */
export function excerptAround(text, index, len) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + len + 30);
  return (start > 0 ? '...' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < text.length ? '...' : '');
}

/**
 * Scan one block of prose. The retrospective path: what has already been typed.
 *
 * Conservative for the same reason the injection scanner is, with one extra
 * reason: a false positive here tells somebody their own words leaked money.
 */
export function scanText(text, location = 'prompt') {
  const hits = [];
  if (typeof text !== 'string' || !text) return hits;
  for (const p of LEAK_PATTERNS) {
    const m = p.re.exec(text);
    if (m) {
      hits.push({
        location,
        pattern: p.name,
        category: p.category,
        maskable: p.maskable,
        excerpt: excerptAround(text, m.index, m[0].length),
      });
    }
  }
  return hits;
}

/**
 * Walk limits. A tool argument tree is attacker-adjacent input in the sense
 * that matters here: it is machine-generated, unbounded, and scanned on a hot
 * path with a 5 second hook timeout.
 */
const MAX_DEPTH = 8;
const MAX_NODES = 2000;

/**
 * Scan an outbound tool call's arguments. The live path.
 *
 * Walks the whole tree rather than one level. `injection_sniff` reads
 * `inputSchema.properties[k].description` and stops, and that shallowness is a
 * known gap there: a signal one level further down is invisible. Repeating it
 * here would be repeating a mistake that is already written down.
 *
 * `location` is the JSON path, so a hit names the field to redact rather than
 * just the call.
 */
export function scanToolInput(toolName, toolInput) {
  const hits = [];
  let nodes = 0;

  const walk = (value, path, depth) => {
    if (nodes >= MAX_NODES || depth > MAX_DEPTH) return;
    nodes++;
    if (typeof value === 'string') {
      hits.push(...scanText(value, path));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        // The KEY is a signal on its own. A field literally named
        // affiliate_id leaks whatever its value is, and a value-only scan
        // reads the value and misses the name.
        hits.push(...scanText(k, `${path}.${k} (key)`));
        walk(v, `${path}.${k}`, depth + 1);
      }
    }
  };

  walk(toolInput, String(toolName ?? 'tool'), 0);
  return { hits, truncated: nodes >= MAX_NODES };
}

/**
 * Which tool calls can leak anything at all.
 *
 * A leak is something LEAVING the machine, so the filesystem tools are not in
 * scope and excluding them is not an optimisation. Two concrete reasons:
 *
 * 1. `Write` and `Edit` carry whole file bodies. Scanning them means scanning
 *    this file, whose pattern source contains every string the patterns look
 *    for, and reporting that as a leak. A detector that flags its own
 *    definition is worse than no detector.
 * 2. `Read` and `Grep` disclose to nobody. Counting them would inflate the
 *    denominator with calls that had no outbound channel, which makes a leak
 *    rate look better than it is.
 *
 * `Bash` is in scope conditionally, because almost all of it is local. The
 * discriminator is the command's own verb, which is the most structural signal
 * available on a free-text command line.
 */
export const EGRESS_TOOLS = ['WebFetch', 'WebSearch'];

/** Network verbs. Anything here reaches off the machine by design. */
const NETWORK_VERBS = /(^|[\s;|&(`$])(curl|wget|nc|ncat|telnet|ssh|scp|rsync|ftp|http|https|git\s+(?:push|pull|fetch|clone|ls-remote)|gh\s+\w|npm\s+(?:publish|install|i|view|search)|pip\s+install|npx|wrangler|aws|gcloud|az)\b/;

/**
 * Does this tool call have an outbound channel?
 *
 * Returns the reason it is in scope, or null. A string rather than a boolean so
 * a report can say WHY a Bash call was read, which is the difference between a
 * reviewable finding and a claim.
 */
export function egressReason(toolName, toolInput) {
  const name = String(toolName ?? '');
  if (EGRESS_TOOLS.includes(name)) return name;
  if (name.startsWith('mcp__')) return 'mcp';
  if (name === 'Bash' || name === 'PowerShell') {
    const cmd = toolInput && typeof toolInput.command === 'string' ? toolInput.command : '';
    const m = NETWORK_VERBS.exec(cmd);
    return m ? `shell:${m[2]}` : null;
  }
  return null;
}

/**
 * Roll hits up for reporting.
 *
 * `prompts` is the denominator and is required, not optional. A leak count with
 * no denominator is the shape of a number that cannot be argued with: 12 hits
 * across 12 prompts and 12 across 900 are different findings.
 */
export function summarise(hits, { prompts = null } = {}) {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const byMaskability = Object.fromEntries(MASKABILITY.map((m) => [m, 0]));
  const byPattern = new Map();

  for (const h of hits) {
    if (byCategory[h.category] !== undefined) byCategory[h.category]++;
    if (byMaskability[h.maskable] !== undefined) byMaskability[h.maskable]++;
    byPattern.set(h.pattern, (byPattern.get(h.pattern) ?? 0) + 1);
  }

  return {
    total: hits.length,
    prompts,
    byCategory,
    byMaskability,
    // Sorted so a report is stable run to run. Ties break on name.
    byPattern: [...byPattern.entries()]
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)),
    // Which rows never fired. An unvalidated table's most useful output: it
    // says which of our guesses the real world does not contain.
    silent: LEAK_PATTERNS.map((p) => p.name).filter((n) => !byPattern.has(n)).sort(),
    patternsTotal: LEAK_PATTERNS.length,
  };
}
