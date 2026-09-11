# Clembot-doorman

**One-liner:** We graded 23 live MCP servers by actually using them. One is a real
product running an ad inside your agent's context window, and we kept the tape.

**Second line (the how):** A doorman agent for Claude Code that grades unknown MCP
servers before any subagent gets one, and pays per grade via x402 through a
Bazantic gateway.

> **Lead with the finding, not the architecture.** The build is the answer to
> "how did you catch that", never the opening. A finding travels to a judge who
> has never written an MCP server; an architecture does not. Decided 2026-09-05
> after reading the site as a judge would and finding the story four screens
> down.

**Status:** Kickoff — Sept 1, 2026
**Deadline:** ETHOnline 2026 submission — Sun Sept 13, 12:00pm EDT (event Sept 4–16)
**Owner:** Clemens Wan / Wanessa Labs
**Sites:** clembot.wanessalabs.com (demo viewport) · scorecard gateway via Bazantic custom domain

---

## Why (prize mapping)

| Bazantic prize | How this project wins it |
|---|---|
| Help an Agent Use Your Project (Continuity, 2×$500) | A/B: doorman with recipe vs. raw API docs, on the real Clembot Research branch |
| Agentify a new API ($500/300/200) | The scorecard API is new to Bazantic; recipe makes it reusable by any agent |
| Best multi-API Recipe ($500/300/200) | Grade a sponsor MCP server → anchor evidence hash on Hedera/0G in one recipe flow |

**Positioning sentence (use everywhere):** "Graded by being used, not by being read. Don't trust the letter, replay the tape."

**The honesty is the differentiator, so gather it rather than scatter it.** Every
"not built" on the site used to sit where it applied, which reads as unfinished
to someone skimming 200 submissions. They now also appear together under
**"What this refuses to do"**, where the same sentences read as discipline. No
claim was softened to do this: the section states outright that 70 of the 100
points on every published grade are unmeasured.

---

## Architecture (two repos, deliberately separate)

### Repo 1: `mcp-scorecard` — the service (what Bazantic wraps)
- Cloudflare Worker + Workflows + D1
- `POST /grade` — accepts `[{name, url, needed_for}]`, returns graded list
- `GET /grade/:server` — cached grade read (cheap tier)
- `GET /allowlist/:owner` — public published trust list
- `GET /badge/:server.svg` — grade badge with probe date + model version
- OpenAPI spec served at `/openapi.json` (Bazantic import surface)
- Probes that need long model runs execute via Workflows; behavioral runs call Anthropic API with pinned model + temperature

### Repo 2: `clembot-doorman` — the open-source client (the giveaway)
- `.claude/agents/doorman.md` — subagent, tools: `Read`, `mcp__bazantic-scorecard__grade` only
- `.claude/hooks/mcp-gate.sh` — PreToolUse hook, matcher `mcp__.*`, local-file lookup, exit 2 on unknown servers, 5s timeout
- `registry/allowlist.json`, `registry/denylist.json`, `registry/pending/`, `registry/ledger.jsonl`
- `recipes/` — per-server usage recipes drafted from grade output
- `/vet <url>` slash command
- x402 wallet config with hard spend cap ($5 demo funding)
- README written as the recruitment pitch: clone, fund, protected

### Demo site: `clembot-site` (can live inside repo 2)
- Cloudflare Pages, one page: architecture diagram (existing SVG), intake field (MCP URL + subagent dropdown), live log (poll `/api/ledger` every 2s — no Durable Objects), verdict card with drafted recipe, ledger table
- Site is a **viewport**: form → D1 `pending` → real doorman on laptop polls → grades → posts back to `/api/ledger`

---

## The Grade (spec summary)

**Weights:** Static 30 / Behavioral 50 / Guidance delta 20. Bands: A ≥85, B 70–84, C 50–69, F <50.
**Hard fails (cap at F):** injection-shaped content in descriptions or results; no TLS.
**Each behavioral probe ×3 runs, pinned model + temperature. Grade is model-relative — print model on badge.**

Six probes (named as doorman Skills):
1. **Handshake & Inventory** — connect, tools/list, schema lint (wrap mcpscore). Free exit for dead servers.
2. **Cold Open** — task generated from `needed_for`, fresh agent, server descriptions only. Score: first-try tool selection, first-try schema validity, completion, steps.
3. **Ambiguity Gauntlet** — fires only when tools overlap; task phrased to tempt the wrong tool.
4. **Bad Input Recovery** — omit required param; does the error message enable self-correction ≤2 turns?
5. **Chain Test** — two-step task, B consumes A's output; skip if <3 tools.
6. **Injection Sniff** — scan-only for v1.

**Evidence bundle per audit:** `grade.json` (machine) · `report.md` (1 page, hard limit: grade, sub-scores, 3 worst failure modes, provenance section ungraded) · `recipe.md` (drafted usage recipe from failure modes) · badge SVG. Bundle hashed SHA-256; hash + grade + timestamp anchored on Hedera Consensus Service (or 0G). Badge links to anchor.

---

## Build plan (dates are real)

### Pre-hack: Mon Sept 1 – Wed Sept 3
- [ ] Register ETHOnline (stake refundable ETH); confirm Continuity Track rules re: pre-existing Clembot code
- [ ] Create bazantic.com account; verify in-product: fee/rev share, chains, recipe format, OpenAPI import — update this doc with findings
- [ ] Ask Bazantic (Discord/contact) whether the blog-work relationship affects prize eligibility — get it in writing
- [ ] Scaffold both repos, D1 schema, wallet setup (USDC on Base, $5, spend cap)
- [ ] Write the 6 probe task templates per tool-category (this is thinking work — do it before the clock starts)

### Week 1: Thu Sept 4 – Sun Sept 7 — the engine
- Day 1: `mcp-scorecard` Worker skeleton, D1 schema, wrap mcpscore for Static layer, `/grade` returns static-only grade
- Day 2–3: Behavioral probes 2–4 via Workflows (or laptop-run fallback if Workflow limits bite); grade math; `grade.json` + `report.md` generation
- Day 4: Guidance delta (rerun with drafted recipe); recipe.md generator; evidence bundle + SHA-256 + Hedera anchor

### Week 2: Mon Sept 8 – Thu Sept 11 — the doorman + Bazantic
- Day 5: `clembot-doorman` repo — subagent, hook, registry files, `/vet` command; wire wallet; end-to-end grade of a real server, paid
- Day 6: Bazantic onboarding — gateway, MCP server, custom domain, write all three prize recipes
- Day 7: Demo site (intake → pending → doorman → ledger → verdict card); public allowlist page
- Day 8: Plant the known-bad fixture server; full dress rehearsal; fix the top 3 breaks

### Final: Fri Sept 12 – Sat Sept 13 — proof & submission
- Day 9: Record 3 videos (one per prize, <3 min each, problem-first, receipts on screen); A/B transcripts captured
- Day 10 (morning): Submissions in by noon EDT Sept 13 — do NOT submit at 11:50

**Cut order if slipping:** Chain Test → site polish → guidance delta → Ambiguity Gauntlet. Never cut: Cold Open, the hook, the payment on camera, the planted F.

---

## Video beats checklist
- [ ] 402 challenge visible in log
- [ ] Payment + receipt + wallet balance tick
- [ ] Grade B verdict card + drafted recipe file
- [ ] Planted server grades F → hook blocks it in terminal
- [ ] Ledger: N audits, $0.XX spent, X denied
- [ ] A/B side-by-side: raw docs fail vs. recipe-guided success
- [ ] On-chain anchor lookup of an evidence hash

---

## Claude Code kickoff prompt (paste into Claude Code at repo root)

```
You are helping me build Clembot-doorman for the ETHOnline 2026 hackathon,
due Sept 13. Read CLAUDE.md and clembot-doorman-project.md in this directory
first — they are the source of truth. Work in three gated phases and STOP
for my approval between each phase.

PHASE 1 — INVENTORY (read-only, no writes):
1. Inspect the current directory and any existing repos I point you to.
2. Verify tool availability: wrangler, node, python, pip. Check whether
   mcpscore installs cleanly (pip install mcpscore) and run it against
   one public MCP server URL I provide, capturing its output shape.
3. Produce a gap list: what exists vs. what the project doc requires,
   with any risks (Workflow duration limits, mcpscore output format
   mismatches, wrangler auth). Print the list and STOP.

PHASE 2 — PLAN (no code yet):
1. Propose the exact file tree for both repos (mcp-scorecard and
   clembot-doorman) with one-line purpose per file.
2. Propose the D1 schema (audits, pending, allowlist tables) as SQL.
3. Propose the grade.json schema and the probe-runner interface so that
   probes can run either in a Cloudflare Workflow or locally on my
   laptop behind the same interface (this fallback is mandatory).
4. List every external dependency and every secret/env var needed
   (Anthropic API key, wallet key, Hedera creds, D1 binding).
   Print the plan and STOP.

PHASE 3 — GATED EXECUTION (after my approval, in this order):
1. Scaffold mcp-scorecard: Worker, D1 migrations, /grade endpoint
   returning a Static-layer-only grade by wrapping mcpscore. Include
   an OpenAPI spec at /openapi.json. Write a smoke test that grades
   a public MCP server and asserts a numeric score.
2. Implement probes as separate modules behind the probe-runner
   interface: cold_open, ambiguity, bad_input, chain, injection_sniff.
   Each probe: pinned model, temperature 0, 3 runs, returns sub-scores
   + full transcript JSONL. Implement grade math (30/50/20, hard-fail
   overrides, bands A>=85 B>=70 C>=50).
3. Implement outputs: grade.json, one-page report.md (hard cap one
   page), recipe.md drafted from failure modes, badge SVG endpoint,
   SHA-256 of the evidence bundle, and a stub anchor() function for
   Hedera that logs the hash (real anchoring is a later step).
4. Scaffold clembot-doorman: the subagent .md, the PreToolUse hook
   script (matcher mcp__.*, local JSON lookup only, exit 2 on unknown,
   never a network call), registry JSON files, /vet slash command,
   and a poller script that watches the Worker /api/pending endpoint.
5. After each numbered step: run the tests, show me a diff summary,
   and STOP for approval before the next step.

CONSTRAINTS:
- Cloudflare free tier only (no Durable Objects; poll, don't stream).
- The hook must be deterministic and offline — it is a security gate.
- The doorman subagent gets exactly one MCP tool. Never widen it.
- All probe transcripts are evidence: never truncate, never edit.
- If a step needs a secret I haven't provided, stop and ask; never
  fabricate or hardcode credentials.
- Prefer boring code over clever code. This ships in 9 days.
```

---

## Open questions (answer during pre-hack, update this doc)
1. Bazantic fee/rev share, supported chains, recipe format — from inside the product
2. ETHGlobal Continuity Track: exact rules on pre-existing code + sponsor-relationship eligibility
3. Cloudflare Workflows: max duration/steps on free tier vs. probe runtime → decides Workflow vs. laptop-runner default
4. Hedera vs. 0G for anchoring — pick whichever has the simplest testnet path and a live sponsor bounty
5. x402 client library choice for the wallet (Coinbase SDK vs. community client on Base)
