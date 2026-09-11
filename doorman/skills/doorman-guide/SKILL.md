---
name: doorman-guide
description: Package manager and security gate for agent tools. Inspects your build, analyzes prompt history to recommend safe MCP servers, audits candidate tools for prompt injections, runs local fit reviews against existing skills, and blocks rogue tools at the gate.
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

## Capabilities & Commands

### 1. Inspect Your Build (`doorman doctor`)
```bash
doorman doctor
```
- **L0 check**: 100% local, read-only, costs zero tokens.
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
