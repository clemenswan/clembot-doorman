---
name: doorman-guide
description: Package manager and security gate for agent tools. Grades your agent harness build and opens it as a local dashboard, analyzes prompt history to recommend safe MCP servers, audits candidate tools for prompt injections, runs local fit reviews against existing skills, and blocks rogue tools at the gate.
---

# Doorman Skill

The package manager and security doorman for AI agents.

Use this skill when:
- Setting up a net-new agent build or inspecting what tools your project can currently reach.
- Recommending or discovering new MCP tools and skills based on real user prompt history.
- Evaluating a candidate MCP server, GitHub repository, or new skill before installing it.
- Checking whether a proposed capability is already covered by existing skills or subagents.
- Verifying the local offline security hook (`PreToolUse` gate).

---

## Start here

**Run this first, before answering anything about the user's build:**

```bash
doorman dashboard
```

Run it from the project root that actually holds `.claude/` — the grade is scoped
to the directory you point it at, and a subfolder scores its own emptiness. Pass
a path if the working directory is not it: `doorman dashboard ../..`

It runs the whole free sweep (doctor, prompt-history needs, the graded feed),
grades the build against a visible five-check scorecard, diffs it against the
last run on a different day, writes `.doorman/report.html` and opens it. No
server, no port, no key, no dependency, nothing billed.

The terminal summary is the short version; the page is the readable one. Relay
the grade, the letter movement since the last run, and the top two or three
recommendations. Do not restate the whole page back at the user, they are
looking at it.

### Reading the grade honestly

- The letter is arithmetic over the five checks printed beside it, nothing else.
  If a check looks wrong, the evidence file that produced it is on the same row.
- A **skipped** check is not a failed one. No subagents means no exposure to
  measure, and it drops out of the denominator rather than scoring zero.
- Capability gaps are **not** in the grade. A missing tool is a recommendation
  about what the build does not have, not a defect in what it does.
- A recommended candidate is **worth measuring**, never a fit. Nothing on the
  page has been driven against the build. `/vet <url>` is the next step, and it
  runs the free fit review before anything can spend.

### Making it a weekly newsletter

Each run drops a small snapshot in `.doorman/runs/<date>.json`, which is what
lets the next run say "the gate went from inert to wired, two gaps closed". Use
the OS scheduler, not a daemon this tool does not ship:

```bash
# macOS / Linux, Mondays at 09:00
(crontab -l 2>/dev/null; echo "0 9 * * 1 cd /path/to/project && doorman dashboard") | crontab -
```

```powershell
# Windows, Mondays at 09:00
schtasks /create /tn "doorman weekly" /sc weekly /d MON /st 09:00 ^
  /tr "cmd /c cd /d C:\path\to\project && doorman dashboard"
```

---

## Capabilities & Commands

### 1. Inspect Your Build (`doorman doctor`)
```bash
doorman doctor
```
- **L0 check**: 100% local, read-only, costs zero tokens.
- Prints the same five-check grade the dashboard shows, in the terminal.
- Reports active harness (Claude Code, Cursor, Windsurf, Copilot, Gemini), reachable MCP servers, subagents, and gate wiring status.
- Calculates agent-to-tool exposure ratios to stop tool bloat.

### 2. Discover Needs from Prompts (`doorman needs`)
```bash
doorman needs
```
- Reads local session transcripts (`~/.claude/projects/`).
- Strips tool outputs, compaction summaries, and slash-command expansions to isolate real human asks.
- Categorizes needs across 12 taxonomies (`docs-lookup`, `web-search`, `database`, `browser-automation`, `cloud-deploy`, `observability`, `payments`, `comms`, `design-assets`, `knowledge-base`, `code-host`, `data-files`).
- Suppresses recommendations for needs already satisfied (`COVERED`).
- Pairs unmet needs with pre-vetted Grade A/B candidates from `scorecard.wanessalabs.com/feed` (`worth-measuring`), flags malicious ones (`blocked`), or notes ecosystem gaps (`GAP`).

### 3. Two-Phase Fit Review (`scripts/vet.mjs --dry-run`)
```bash
node scripts/vet.mjs <candidate-url-or-repo> --dry-run
```
- **Fit first, money second**: Ingests YAML frontmatter (`name`, `description`) of all installed skills and agents.
- If an existing skill already handles the ask, it returns `REDUNDANT` and cites the exact skill name.
- Stops immediately at Phase 1 ($0.00 spent) before contacting any external scorecard.

### 4. Static Protocol & Injection Scan (`doorman report <url>`)
```bash
doorman report <url>
```
- Scans MCP tool descriptions for prompt injection, hidden steering ads, and protocol violations.
- Caught WebZum's 6,290-character in-context steering ad on live internet.
- Caps hostile tools at Grade F.

### 5. Monitor Live Feed (`doorman watch`)
```bash
doorman watch --all
```
- Streams newly graded candidates from the public feed.
- Categorizes them against local inventory: `already-installed`, `blocked`, `unreviewed`.
- Warns if an installed server suffers a security demotion.

---

## Guiding Principles

1. **Say No to Redundant Tools**: A tool that duplicates an existing skill costs tokens, pollutes context, and increases hallucination risk. Always run the fit review first.
2. **Never Grade Documentation as Proof**: Documentation describes what authors wish was true. Doorman measures what tools actually do when an agent executes them.
3. **Fail Closed**: If a tool is unapproved or cannot be verified, the gate blocks it at exit 2. Never bypass the security hook.
4. **Never Report a Number You Cannot Show the Working For**: every grade on the dashboard prints its checks, its points and the file that proved each one. A letter a reader cannot recompute by hand is the thing this project exists to distrust.
