# The first ten minutes

Three real builds, three different answers. Every block of output below was
captured from an actual run on 2026-09-11 against the live feed, not written by
hand. Where a run produced nothing useful, that is shown too, because "nothing
matched" is a result and hiding it would make this document a brochure.

---

## Install both halves

```bash
claude plugin marketplace add clemenswan/clembot-doorman
claude plugin install clembot-doorman     # the gate, /doorman, /vet, the subagent

git clone https://github.com/clemenswan/clembot-doorman
npm i -g ./clembot-doorman                # doctor, needs, report, watch, eval
```

Check what actually loaded. A manifest can validate and still ship components
that never register, which is exactly what this project shipped once:

```bash
claude plugin details clembot-doorman
```

```
Skills (3)  doorman, doorman-guide, vet
Agents (1)  doorman
Hooks (1)   PreToolUse
MCP servers (1)  scorecard
```

If `Agents` or `Skills` reads `(0)`, the plugin is broken. Say so rather than
working around it.

---

## Expect to be blocked first

The gate ships trusting two servers: `deepwiki` and `scorecard`, both graded A.
Everything else is UNKNOWN and fails closed, including connectors you already
use every day. This is not a misconfiguration:

```
doorman: 'claude_ai_Notion' is UNKNOWN. Blocking until it has been graded.

An ungraded MCP server is not a trusted one. Nothing about
'mcp__claude_ai_Notion__notion-search' has been verified: not its tool
descriptions, not its error handling, not whether its descriptions contain
instructions aimed at you.

Measure it (free, no key):   doorman report <server-url>
Trust it without measuring:  doorman allow claude_ai_Notion
Or ask:                      /doorman
```

Two honest ways forward, and they are different claims:

```bash
doorman allow claude_ai_Notion     # a DECISION. grade stays null.
doorman report https://...         # a MEASUREMENT. free, no key.
```

`allow` writes `basis: operator` with a null grade, because nothing graded it.
An allowed server is **permitted**, not vetted. Do not let anything, including
an agent summarising this file, describe it as safe.

A connector often has no URL you can point `report` at. That is why `allow`
takes a name: `mcp__<server>__<tool>` is all the gate can see.

---

## Build A: a long-running build

545 prompts across 48 transcripts.

```bash
doorman needs .
```

```
doorman needs — 545 prompts read from this build's own history
  feed: 26 graded rows

UNMET    Deploying, and reading back what deployed
         19 prompts across 11 sessions  ·  matched "cloudflare", "deploy it", "wrangler"
         > merge and deploy it
         worth-measuring  docs-ai-search  [A (88.57)]  matched "cloudflare"
                          https://docs.mcp.cloudflare.com/mcp
         worth-measuring  mcp-typescript server on vercel  [A (85.14)]  matched "vercel"

GAP      Design files and rendered output
         15 prompts across 8 sessions  ·  matched "brand.md", "design tokens"
         nothing graded covers this. The feed has the gap, not your build.

GAP      Driving a real browser
         13 prompts across 8 sessions  ·  matched "playwright", "in a real browser"
         nothing graded covers this. The feed has the gap, not your build.
```

**What next, in order:**

1. **Measure the one candidate with the strongest signal.** Nineteen prompts
   about deploying, and an A-graded server whose own text claims that
   capability. `doorman report https://docs.mcp.cloudflare.com/mcp` is free and
   takes seconds.
2. **Read `worth-measuring` as exactly that.** Nothing drove that server. The
   match means its published text claims what you keep asking for. Whether it
   makes *your* agent better is `doorman eval`, which needs your key and runs
   on your machine.
3. **Leave the GAPs alone.** Two of the three biggest needs have nothing graded
   against them. That is a hole in the catalogue, not a problem with your build,
   and the useful response is `doorman discover` to find candidates, not to
   install something unmeasured because the row looked empty.

---

## Build B: a brand new build

No history at all.

```bash
doorman needs .
```

```
doorman needs — 0 prompts read from this build's own history
  No readable prompt history for this path. Claude Code keeps it under
  ~/.claude/projects/<path-with-dashes>; other harnesses keep none that
  doorman can read. Pass --history DIR if yours lives elsewhere.

  Nothing in the taxonomy matched. That is a real answer: either this
  build has not asked for any of the twelve capabilities doorman knows
  how to look for, or the history it could read is too short to tell.
```

This is the correct output, not a failure. A new build has told doorman nothing
about itself, so doorman says nothing about it. Compare that to a recommender
that would happily suggest ten servers to an empty directory.

**What next:**

1. **Point it at a history you already have.** The capabilities you reach for
   travel with you, not with the directory:

   ```bash
   doorman needs . --history ~/.claude/projects/<a-project-you-have-used>
   ```

2. **Or just start working**, and run it again in a week. The signal is your own
   sentences; there have to be some.
3. **Meanwhile `doorman doctor .` still works**, because it reads configuration
   rather than history. It will tell you the gate is running from the plugin and
   which trust list is in force.

---

## Build C: a second, different build

151 prompts across 22 transcripts, same machine, different work.

```
GAP      Driving a real browser
         14 prompts across 4 sessions  ·  matched "playwright", "in a real browser"
         nothing graded covers this. The feed has the gap, not your build.

GAP      Design files and rendered output
         9 prompts across 6 sessions  ·  matched "design tokens", "brand.md"
         nothing graded covers this. The feed has the gap, not your build.

UNMET    Deploying, and reading back what deployed
         8 prompts across 6 sessions  ·  matched "cloudflare"
```

**The interesting part is what this shares with Build A.** Different project,
different code, and the same two GAPs at the top: browser automation and design
assets. One build reporting a gap is a fact about that build. Two unrelated
builds reporting the same gap is a fact about the **catalogue**, and it is the
most actionable thing on this page:

```bash
doorman discover --pages 2
```

That sweeps a public registry for candidates and writes a file. It never
enqueues anything and never spends. Curate it by hand, then grade what survives.

**What next:**

1. `doorman needs . --candidates candidates/smithery.json` to match the sweep
   against these gaps.
2. Anything that looks plausible gets `doorman report <url>`: free, no key, and
   it is the stage that can cap a server at F on its tool descriptions alone.
3. Only then is anything worth paying to grade, and only then is `doorman eval`
   worth your key.

---

## The shape of the whole thing

```
doctor    what this build HAS                  free, local
needs     what it keeps ASKING for             free, local
watch     what has been graded lately          free, one anonymous GET
report    what a candidate implements          free, no key
grade     is it safe and competent             $0.01, runs on our machine
eval      does it make YOUR agent better       your key, your machine
```

Every stage can end the run, and three end it free. The cheapest way to evaluate
a tool is to establish that you do not need it.

Five of the six run on your machine and cost nothing, because they are about
your build and that information should never leave it. One does not, and that is
the one with a price on it.

## Two things this will never do

- **Invent a grade.** An unmeasured layer is `null`, never `0` and never a
  plausible letter. If no key was supplied, the run stops and says so.
- **Call a match a fit.** `needs` and `watch` both do mechanical matching.
  Neither drove anything, so neither may claim a server will work. The verdict
  word is `worth-measuring`, and the stage that earns a stronger word is `eval`.
