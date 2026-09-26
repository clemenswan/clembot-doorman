---
title: doorman profile, the harness report
status: v1
updated: 2026-09-22
---

# `doorman profile`

Grades a Claude Code harness the way the scorecard grades an MCP server: named
checks, a receipt per check, and a number nobody has to take on trust.

It reads the harness surface only and writes to `.doorman/`. Nothing leaves the
machine unless `--export` is run, and an export carries structure only.

```
doorman profile [path] [--export] [--sow] [--reference NAME] [--name NAME] [--online] [--json]
```

---

## The surface it reads

A closed list, declared as data in `src/profile/surface.mjs` so it can be
audited at a glance instead of traced through control flow.

| Path | Read as |
|---|---|
| `CLAUDE.md`, `AGENTS.md` | text |
| `.claude/settings.json`, `.claude/settings.local.json` | JSON |
| `.mcp.json` | JSON |
| `.claude/agents/*.md`, `.claude/commands/*.md`, `.claude/rules/*.md` | frontmatter + text |
| `.claude/skills/*/SKILL.md`, `.claude/skills/INSTALLED.md` | frontmatter + text |
| `.claude/hooks/*` | **names only**, never contents |

Hook bodies are shell scripts, and a script body is code. That a hook exists
and what it is wired to is configuration, which is inside the surface; what it
does is not.

**Never opened**, even when a listed directory would reach them: `.env` and
variants, `*.pem`, `*.key`, `id_rsa*`, anything matching `credentials`.

**Symlinks are resolved and re-checked against the root.** A symlink is the one
way an allowed path can name a file outside the tree, and "we only read
`.claude/`" stops being true the moment one points at `~/.ssh`. A link that
escapes is recorded as a problem, not followed.

## Fail closed

A file that exists and will not parse counts **against** the dimension it
belongs to. A malformed `settings.json` must not read as "no dangerous
permissions found", because that is the sentence a clean one produces too.
Unparseable files are listed by name in the report.

An **undeclared** agent tool set resolves to write-capable and ungated. Unknown
takes the unsafe reading, not the convenient one.

## `n/a` is not zero

A repo with one write-capable agent has no concurrency to measure, and scoring
that zero would rank it below a repo whose agents collide. Those checks return
`n/a` and drop out of the denominator. This is invariant 3.

---

## The rubric: 7 dimensions, 10 checks

Ten, not thirty-five. Every check here is one a person can run by hand against
a real `.claude/` tree and agree or disagree with. `needs.mjs` already carries
the reason: a taxonomy that looks thorough and cannot be hand-checked is a
confident wrong answer waiting for a user. The table is data; a new check is a
new row.

| # | Dimension | Check id | Max | What it asks |
|---|---|---|---|---|
| 1 | Permission hygiene | `perm-explicit` | 4 | A permissions block exists with both allow and deny |
| 1 | Permission hygiene | `perm-bash-wildcard` | 3 | No `Bash`, `Bash(*)` or `Bash(*...` in any allow list |
| 2 | Human gates | `gate-tools-declared` | 4 | Every agent declares a `tools` field |
| 2 | Human gates | `gate-write-declared` | 4 | Write-capable agents declare isolation, allowed-paths, or a documented dispatch |
| 3 | Evidence | `evidence-convention` | 5 | A checkpoint command exists **and** CLAUDE.md names the convention |
| 4 | Tool vetting | `vet-registry` | 4 | Every `.mcp.json` server appears in a rules file or INSTALLED.md |
| 4 | Tool vetting | `vet-declined-ledger` | 3 | Something records what was declined or deprecated |
| 5 | Parallelism | `par-shared-writer` | 4 | Two or more write-capable agents are bounded by isolation or allowed-paths |
| 6 | Memory | `mem-handoff` | 4 | Cross-session state exists **and** is referenced |
| 7 | Registry hygiene | `reg-drift` | 3 | Every agent and command on disk is named in some doc |

### The overall band is the worst dimension

Not the average. A harness is as mature as its weakest gate, so one failing
dimension caps the report. The average is printed beside it so the rule is
visible rather than surprising, and both numbers appear in `report.json`,
`report.md` and the dashboard.

### No maturity ladder

An earlier draft mapped the dimensions onto a seven-rung ladder with named
levels. The names did not exist anywhere, so inventing them would have shipped
vocabulary nobody chose, inside a published profile format. Dimensions carry
the letter bands `harness-grade.mjs` already uses. The weakest-gate rule was
the useful half of the ladder idea and it survives without the naming.

---

## The export contract

`--export` writes `profile.json`: structure only, with the redaction scanner
over it.

**Carried:** counts, check states, points, dimension scores, and receipts,
which are repo-relative paths.

**Never carried:** the absolute repo root, any `note` prose, and anything
derived from file contents. Notes are assembled from the repo's own text, and
the cheapest way never to leak prose is never to put prose in the file.

**The slug is hashed by default** (`repo-<8 hex>`), so an exported profile does
not name the prospect. `--name` overrides when a readable label is wanted.

Anything tripping the scanner is **dropped, not masked**, and counted:

```json
{ "redacted_count": 3, "redacted_rules": ["email", "secret"], "complete": false }
```

A masked value still reveals its length and position. And a redacted profile
must be visibly incomplete, so nothing compares it against a full reference and
reads the difference as a finding.

### The scanner

Vendored from `wanessalabs-astro/scripts/lib/redaction.mjs`, itself a copy of
`marketing-bootstrap/scripts/lib/site-redaction.js`. This is the **third copy**
and that is a real risk, stated openly: its own parent's header says "two
publishers with two copies of a security rule is how one of them ends up a
version behind".

Vendored anyway because the npm package ships `doorman/` and nothing else, so
an installed user has no sibling worktree to import from, and a control that
only works in the author's checkout is not a control. `profile-redaction.test.mjs`
parses the parent and fails when the **inherited** rows diverge, and skips
itself when the parent is absent.

Twelve inherited rules, four added here: `session_id`, `git_remote`,
`git_author`, `foreign_host` (any host not on a short public allowlist).

---

## Artifacts

```
.doorman/profile/<slug>/<date>/report.json    everything measured, local only
.doorman/profile/<slug>/<date>/report.md      the same for a human
.doorman/profile/<slug>/<date>/profile.json   --export only, structure + redaction
.doorman/profile/<slug>/<date>/sow.md         --sow only
```

`.doorman/` rather than `outputs/` because `.doorman/` is already gitignored and
already where `dashboard` writes. `outputs/` is ignored nowhere, so a report
naming a prospect's file paths would land in their next commit, and the first
thing this tool did would be to leak into their history.

## The statement of work

One work package per open check, grouped by dimension, ordered by gap size
divided by effort so cheap wins sort first. Every package names its check id,
its receipt, and an acceptance criterion that is literally re-running the tool.

Commercial fields are `{{slots}}`: engagement model, rate, duration,
milestones. A generated day rate would be the one number in the document nobody
can check. **Acceptance criteria are not slots** and derive from check ids,
which is the part of the document that is earned.

A fully passing harness produces no work packages and says so. A generator that
always finds work is a generator nobody trusts.

---

## The authority

Two public reads on the existing Worker, free, on `NEVER_PAID` alongside
`/feed`. Invariant 22 says the tape is never chargeable; a pattern card is the
same kind of thing, because a finding you have to pay to read is a finding you
cannot act on.

```
GET /patterns?dims=2,4&ids=perm-explicit    one card per check that can fail
GET /profiles/:name                         published reference profiles
```

A malformed `dims` yields **no filter**, never an empty result: "no cards" and
"nothing wrong in that dimension" read identically otherwise.

`/profiles/:name` answers 404 in v1 and says why. The decision was bundle-only;
the route exists so the client code is final and publishing later is a seed
rather than a release.

**The client never depends on the authority being reachable.** `--online` is
off by default and falls back to the bundled cards, because the room this gets
demoed in may have no egress and a dashboard that renders nothing because a
fetch failed is worse than one that renders a snapshot and says so. The
authority and the bundle are seeded from the **same files**, so they cannot
disagree about what a card says.

## The dashboard

Three views on the existing self-contained page: **My report**, **vs
reference**, **Authority feed**. Tabs are radio inputs and sibling selectors;
the radar is inline SVG. No script tag, no CDN, no font fetch, no dependency,
which is what makes the page work in a locked-down room.

The authority view shows cards for **failed checks only**. Advice about things
already passing pads the page and buries what to act on.

---

## Assumptions taken where a question went unanswered

Recorded here because they were decisions, not defaults that fell out.

1. **Command named `profile`, not `harness`.** `cli/harness.mjs` already means
   the agent loop inside the eval sandbox, and `doctor` reports `harnesses` for
   detected tooling. A third meaning on a public command would be the worst one.
2. **No maturity ladder.** See above. No named levels existed to use.
3. **`pass/warn/fail/n-a`, not `ADOPT/DECLINE/INCONCLUSIVE`.** Those verdicts
   are about adopting somebody else's tool. You do not ADOPT your own
   permission hygiene. `harness-grade.mjs` already had the right vocabulary,
   tested, including partial credit that cannot round to full marks.
4. **Zero-dependency dashboard, not Vite + React + Tailwind.** The package
   declares no dependencies as a requirement rather than an achievement, and
   the offline demo requirement is better served by one file than by a build
   that has to succeed behind the prospect's proxy.
5. **Pattern cards are JSON, not YAML.** The in-tree YAML loader is a strict
   subset that rejects an unquoted colon in a value and has no block scalars.
   Every card carries two prose fields.
6. **D1, not KV.** The Worker has no KV namespace. `0004_patterns.sql`.
7. **Two fixtures, not three.** `thin` and `strong`. A mid fixture mostly
   exercises rounding, which a unit test covers more cheaply than a tree.
8. **`.doorman/`, not `outputs/`.** See Artifacts.
9. **Reference profile bundled, not published.** `doorman/profiles/clembot.json`.

## Known limits

- **The bundled reference scores F on one dimension, 88% overall.** It is
  generated from a real vault. Six of seven dimensions band A; `par-shared-writer`
  fails because 19 of 21 write-capable agents declare neither isolation nor
  allowed-paths. That gap was left open deliberately: `allowed-paths` is
  enforced nowhere in that vault, so adding it to nineteen agents would turn a
  check green without changing any behaviour, which is the score-gaming this
  rubric exists to catch. Shipping a real reference with one real gap beats a
  curated perfect one, but it means the "vs reference" view can show a prospect
  ahead on that dimension. Say it out loud in a demo rather than be surprised.
- **`allowed-paths` is a declaration, not an enforcement.** Nothing in the
  harness reads it. The `par-shared-writer` note says so rather than implying a
  runtime boundary exists.
- **Claude Code only.** `doctor` detects seven harnesses; this reads one
  layout. Cursor and Windsurf keep different trees.
- **`reg-drift` tests one direction.** It finds units on disk that no doc
  names. Docs naming units that no longer exist are not yet detected.
- **No toggle round-trip.** `--sow` takes all failed checks or an explicit
  list. The dashboard does not persist selections, because a page that
  remembered toggles would be a page with a database.
