---
project: clembot-doorman
cluster: agency
status: draft
blocked: false
updated: 2026-09-17
---

# Positioning, and the channel

Decided in conversation on 2026-09-17. This is a **draft for review**, not settled
canon. Nothing here has been built. The MVP at the bottom is the only thing
proposed for building, and it is deliberately the smallest piece.

Written because three surfaces had drifted into describing three different
products, and because the channel idea below is new and has no home in `prd.md`
yet.

## The one line

> Wanessa Labs builds software with an agent harness. **Clembot** is that
> harness, published so the method can be audited. **Doorman** is the piece you
> can install yourself, free, and it keeps you connected to what the harness
> learns.

Three surfaces, three jobs, no overlap:

| Surface | Job | Audience |
|---|---|---|
| `wanessalabs.com` | Sells the studio. Hiring happens here. | Prospective clients |
| `clembot.wanessalabs.com` | Proves the method is disciplined. Sells nothing. | Anyone evaluating the studio, and anyone curious |
| `clembot-doorman.wanessalabs.com` | The free front door. Install, grade your build, get the feed. | Developers and AI ops, most of whom will never hire the studio |

## Decisions

Each of these was a live question on 2026-09-17 and now has an answer. Reopen any
of them deliberately, not by drift.

### Clembot is proof, not product

**Clembot is not for sale.** The `/hire/` page goes. It currently sells
single-tenant installs with a marketing-operations deliverables list, voice
configuration and content scheduling, which is a third product that neither the
harness nor the studio positioning claims any more. Marketing operations take
too much manual adjustment to sell as a product right now.

What replaces it: the primary outbound action on `clembot.wanessalabs.com`
becomes Doorman, not a waitlist.

### Bring Your Own Agent is an IP boundary problem

Settled 2026-09-17, and it is the sharpest idea in this document.

Nobody wants to bring their **full** agent into an enterprise engagement, and
the exposure runs both ways:

- Work the agent produces inside the engagement belongs to the enterprise, so
  anything it accumulates there contaminates an agent that then walks out.
- The agent itself, its skills and its accumulated knowledge, can be argued to
  have been handed over by being used on the premises.

Neither is a technical accident. It is what a company's legal compliance
requires, and an agent that ignores it is unusable in exactly the engagements
worth having.

**So you bring a version.** A base agentic setup is instantiated inside the
enterprise, and what is created there stays there. **The gate is the human
deciding what information crosses**, in either direction.

Clients receive the deliverable, not the harness. What they get the benefit of
is a method, brought in a form that respects the boundary.

#### This vault already has the architecture for it

Two existing principles are the foundation, written before the problem had a
name:

- **`code-and-data-apart`**: "The engine is one repo. Every install's data is a
  separate vault the engine reads through an environment variable. They are
  never mixed." That separation is exactly what makes a sanitized instantiation
  possible. The base setup can go in without the accumulation coming with it.
- **`human-gate`**: a person approves everything leaving the system. The
  boundary version is that a person approves everything crossing it, in both
  directions.

Doorman is then the mechanism: it installs a base setup and maintains the
boundary, rather than merely vetting third-party tools.

#### The cut: engine and skills travel, lessons and data never

Settled 2026-09-17, and it maps onto `code-and-data-apart` rather than inventing
a new line.

| Travels into an engagement | Stays home, always |
|---|---|
| Agents, commands, skills, routines, personas | The lesson and dead-end corpus |
| Structure and configuration scaffolding | `memory/`, episodes, recall data |
| | Evidence bundles and client material |

**An unclassified unit stays home.** That is the same fail-closed shape as
invariants 3, 13, 19 and 20: a new unit nobody has thought about must not travel
by default, because the failure mode of the safe default is a missing capability
and the failure mode of the unsafe one is a leak.

#### The base is open; the provisioning is paid

The base harness is public. Anyone can start from it, which is what makes a
Doorman install meaningful and gives the studio its top of funnel. What is
charged for is reading a build and telling it what to add, consistent with paid
grading being the tool's revenue.

The differentiator is therefore explicitly **not the scaffolding**. It is the
accumulation and the judgement, neither of which travels.

#### The boundary is provable, not merely respected

Every crossing writes a hash-chained record naming what moved and who approved
it, using the evidence chain `log-is-the-product` already describes. A promise
becomes an artifact a compliance officer can audit, which is the strongest
enterprise claim in this document and the reason the boundary is worth building
properly rather than asserting.

#### This constrains the MVP, starting at its first commit

Chosen over deferring it, to avoid retrofitting a boundary into a tool that
assumed one machine.

Concretely, the MVP must carry the distinction even though Clemens's own machine
has no boundary on it: every inventory unit and every recommendation is
classified travels or stays, derived from kind and path, and the dashboard shows
which. By the time a real engagement needs a base instantiated, the partition
will have been exercised daily rather than invented under deadline.

Crossing records are **not** in the MVP. There is no boundary to cross on one
machine, and writing a log of nothing would be ceremony. The classification is
the part that has to exist early, because it is the part that is expensive to
add later.

A consequence worth stating plainly: **Doorman's audience is not the studio's
clients.** Clients never install it as part of an engagement. Doorman has to
earn a developer audience on its own merits, and conversion to studio work is a
later, smaller effect.

### Doorman provisions; security is the reason to trust it, not the pitch

Doorman reads a build's own prompt history, works out what that team keeps
trying to do, and helps them get the tools, skills and setup to do it. It grades
what is there and names what is missing.

The gate, the refusals and the WebZum finding move from headline to credential.
"It will not install something hostile, and here is a live example" is a far
easier sentence than the defense funnel, and the finding does better work as
proof of judgement than as a subject in its own right.

This retires **fleet governance** as the framing. Governance sells to someone
whose job is stopping people. Provisioning sells to someone whose job is helping
people, which is a larger and friendlier audience and is what `doorman needs`
already does.

### The install is a channel from one agent to another

The new idea, and the reason this document exists. An install is not a
transaction that ends. It is a standing connection through which the harness can
send a build something relevant to its work.

- **Matching is local.** A signed feed is published; the installed Doorman pulls
  it and decides which items match that build, using its own history and its own
  inventory. Nothing about the client is required to leave the machine, so the
  offline and fails-closed guarantees survive.
- **Reporting is opt-in.** A client may additionally choose to share gap reports.
  Default is share nothing.
- **Registration is optional.** Doorman works fully anonymously. A client may
  volunteer an email or org to receive the human newsletter, separately from
  opting into reporting.
- **The dashboard has two surfaces over one dataset.** Local, for the team that
  installed it, showing what their build is missing. Aggregate, for Wanessa Labs,
  across installs that opted in.

### The feed recommends; it never installs

The feed carries **pointers**, not executables. It says a capability exists and
where to find it. The client's own Doorman then vets and installs that thing on
its own rubric, exactly as it would any unknown third party.

This is what makes a trusted, signed publisher channel safe. Wanessa Labs is
trusted to *recommend*, never to *install*, so "deny beats allow" stays true
without an asterisk: the gate still grades everything that would actually be
installed.

**Matching signal is history plus inventory.** Intent from prompt history,
absence from the installed inventory, and the recommendation fires where the two
disagree: something a team keeps reaching for and does not have.

**On a match, notes may reach the agent; installs wait for a person.** Advice can
flow into context. Anything executable stops at a human, which is the symmetric
form of the rule that already governs everything leaving the system.

### The feed is guarded at both ends

Notes reaching a model automatically and ungraded is the WebZum shape, and the
threat is not a third party, it is a careless publish by Wanessa Labs.

1. **Scanned before publish.** The feed passes `injection_sniff` in Wanessa Labs'
   own release pipeline. A bad publish fails here rather than in somebody else's
   context window.
2. **Wrapped on arrival.** The receiving Doorman presents feed items as untrusted
   data rather than as instructions, which is the language the generated recipes
   already use for a server that failed.

Running the grader over its own author's output is also the best demonstration
the product has. It is worth doing loudly.

### One newsletter, written once

Each item is authored once and rendered twice, as an agent-readable feed entry
and as a human email. They cannot drift, and the constraint is useful: an item
that does not work in both registers is probably not worth sending.

### The feed publishes what building already produces

**No cadence commitment.** Lessons are written at session end because that is how
the vault works, and the feed renders them. Nothing is ever authored for the
feed. A week that produced no lessons is a quiet week, and saying so is more
honest than manufacturing an item.

This is the whole reason the channel is not a repeat of the mistake that retired
`/hire/`. Marketing operations were dropped because they demanded continuous
manual adjustment. A feed that is a rendering of work already done demands none.
If it ever starts demanding authoring, it has become the thing it replaced.

### Feed content is opt-in per lesson, with the scanner as a backstop

Content comes from the lesson and dead-end corpus, roughly a hundred records
that already exist. Each is a failure with the check that catches it, which is
the most useful shape a pointer can have.

**Nothing publishes until it is marked publishable, and the redaction scanner
still has to pass.** Two independent gates, default silence. The corpus was
written for a private audience: it names client-adjacent work, `financial-hub`,
`family-*` projects, internal paths, and in at least one case a credential to
rotate. Some of it is simply not publishable, and an allowlist is the only
mechanism where the failure mode is a missing lesson rather than a leak.

The scanner is the one `clembot-site` already uses, which aborts an entire export
on a single hit. Reused, not rebuilt.

### Coworker for the studio, harness for the tool

`wanessalabs.com` may talk about working with a coworker, which is the warmer and
more legible metaphor for someone deciding whether to hire.
`clembot-doorman.wanessalabs.com` and the harness documentation use harness,
because that is what it is. The two must not read as unrelated products, so
whichever page bridges them has to say plainly that the coworker runs on the
harness.

### Paid grading is the tool's revenue

Doorman is free to install. **Deep grading costs money**, through the existing
gateway, and that mechanism stays while its chain branding goes. It answers a
real question cheaply, and the one cent against fifty-four dollars comparison is
the argument, not the rail it settles on.

This gives the tool a business that does not depend on installs becoming studio
clients. Two revenue lines, deliberately independent: studio engagements, and
paid grading.

### The hackathon is history, kept as history

ETHOnline 2026 keeps a short blurb and an icon saying the project started there,
framed as the beginning of something that outgrew it. It comes out of the
footer, the badges and the copyright line, where a visitor evaluating a tool
reads chain branding as a crypto demo.

## What this needs that does not exist

Stated so the copy does not promise it first.

- **The scorecard has no rubric for skills or setup.** It grades MCP servers:
  protocol handling, schema hygiene, injection sniffing. Doorman is now
  described as helping with skills and overall configuration, and a dashboard
  that only grades MCP servers will undercut a page that promises more.
- **There is no feed.** No format, no signing, no publish pipeline, no matcher.
- **There is no registration, and no aggregate view.**

## User zero is Clemens, and that reorders the build

Added 2026-09-17, after the decisions above and superseding the MVP they implied.

**The first install is Doorman reading ClemVault.** Clemens wants to point it at
his own build and get back a dashboard that says what would improve it: which
skills, which MCP servers, which setup changes. He is the one deciding whether a
recommendation is any good, which makes him the fastest possible feedback loop.

This is a better first target than a stranger's install, for reasons that all
point the same way:

- **No distribution problem.** Nothing has to be packaged, signed, or installed
  anywhere.
- **No redaction problem.** He is reading his own lessons on his own machine. The
  publish gate only matters once the feed leaves.
- **No registration, no telemetry, no aggregate view**, none of which the MVP was
  going to have anyway.
- **It answers the question that cannot be answered by building more.** The old
  MVP's real risk was whether a receiving agent acts on what arrives. When the
  recipient is the author, that stops being a guess.
- **It is the vault's own pattern.** The scorecard grades itself; `clembot-site`
  publishes an audit of its own build. A provisioning tool that has not been
  pointed at its author's setup has not been tested.

### Most of it already exists

The MVP is largely wiring, not invention:

| Needed | Already there |
|---|---|
| Prompt history | `~/.claude/projects/*.jsonl`. CodeBurn already parses these with no API keys, so the read path has prior art in this vault. |
| Capability gaps from history | `doorman needs`, which already reads prompt history for this purpose. |
| Inventory of the build | `agent-map.json` in `clembot-site` inventories 113 units with the tier that decides whether each can act alone. |
| A grade for a candidate server | The scorecard, unchanged. |
| A surface | `doorman dashboard`. |
| Recommendation corpus | The lesson and dead-end records, already written. |

### What the MVP is

> Point Doorman at ClemVault. **Start from the prompt history.** It reads what
> this vault keeps asking for, aggregates vault-wide, lets a project be opened
> for its own gaps, and shows one panel in `doorman dashboard` saying what to
> add: skills, servers, setup. Recommendations only. Nothing installs without a
> person.

~~Grading stays scoped to MCP servers~~, per the decision above that recommending
does not require a rubric. A recommended skill is a pointer, not a score.

**Reversed 2026-09-23 (PR #137).** Grading is no longer scoped to MCP servers.
`doorman profile` grades the HARNESS across 7 dimensions and 10 checks, with a
receipt per finding and a band set by the worst dimension. The reasoning above
still holds for the half it was written about: recommending a skill is a pointer
and gets no rubric, and `doorman needs` still recommends without scoring. What
changed is that a harness has a measurable surface (permissions, gates, evidence,
vetting, parallelism, memory, registry drift) where a skill does not, so the
rubric has something to read. Contract: `docs/harness-report.md`.

`doorman needs` is already most of this and its constraints are the right ones,
so the work is aggregation, ranking and a surface rather than a new engine.

#### Ranked by measured spend, never by estimated saving

`needs.mjs` says in its own header that the evidence is "a count of their own
sentences rather than a guess about their intentions". Ranking by projected
saving would trade that measured count for an invented number, on the one
surface whose whole argument is that it does not invent numbers, and it would
contradict `verify-not-guess` directly.

So the ranking is **spend already incurred**, which CodeBurn can produce from the
same JSONL: tokens and sessions spent on prompts matching a gap. That orders the
list the way an operator wants, in the units they care about, and leaves the
saving as the reader's inference rather than the tool's claim.

A saving may be claimed later, once a real adoption has a measured before and
after. Then it is evidence.

**Attribution is the hard part, and invariant 28 is the warning.** That invariant
exists because 1548 of 1656 `user` records in a real transcript directory are
tool results, hook attachments, compaction summaries and expanded slash-command
bodies, and counting them inflates every need roughly threefold. Spend has the
same shape from a different direction: cost is recorded per session, one session
touches several needs, and attributing a whole session's tokens to each need it
mentions would inflate every number on the dashboard.

**The rule chosen is an even split**: a session matching three needs gives each
one third. This is defensible only because the rule is deterministic and
published. A stated division a reader can recompute is not a guess; the same
number presented as "this need cost you X" would be, because it would claim a
measurement nobody took.

So the surface must show the division rather than hide it, the way the scorecard
states which layers ran. "4 of 14 sessions, cost shared across 3 matched needs"
is honest. A bare dollar figure is not. And a session whose cost cannot be
attributed at all reports `null`, never a share.

#### Fully deterministic, no model

No hosted model, and no local one either. Term matching and counting only, which
keeps this the same kind of thing as `injection_sniff` and the gate: auditable,
offline, and incapable of being wrong in an interesting way.

#### Counts and terms, never sentences

Prompt history holds client names, credentials and personal material, so the
dashboard never displays an excerpt. It shows the **count and the term that
matched**: "12 prompts matched on `cloudflare`". That gives the basis of a
recommendation, which is what makes a false positive visible, without putting a
single sentence of history on a surface.

#### The term table is hand-curated, and grows from the lesson corpus

`NEEDS` is a hand-written set of term groups, so it finds only gaps somebody
anticipated. That limit is accepted rather than engineered around, and the
corpus of lessons is the source for new entries: those records already name the
failures this vault actually hits, so they are the best available evidence for
which terms are worth watching.

The dashboard should say that it matches a known list rather than reading history
open-endedly, in the same spirit as the scorecard reporting unmeasured layers.

### Phase two

The channel, the signed feed, the publish gate, registration and the aggregate
view. Once this works on a build its author can judge, pointing it at somebody
else's is a distribution problem rather than a product question.

## Sequencing

Decided 2026-09-17.

1. **The Doorman MVP first.** Build the thing, then write copy about a thing that
   exists. Queued as `dq-20260917-clembot-doorman-needs-dashboard`.
2. **`/hire/` becomes a Doorman call to action**, at the same URL, so inbound
   links keep working and the harness site's primary action becomes the free
   front door rather than a waitlist for a retired product.
3. The rest of the copy work follows the MVP.

Known cost of that order: `/hire/` is live right now offering single-tenant
marketing installs, which is the one thing on either site that is actively
untrue. It stays untrue until step 2.

## Later decisions, 2026-09-17

### The base ships inside Doorman

No separate starter repo and no generation step. Installing Doorman gives you the
scaffolding. One install, one artifact, nothing to drift, and the cost is that
the tool's release cycle and the harness's are now the same cycle.

### Lesson-derived recommendations are visible and marked non-travelling

Lessons never travel, but they are the most valuable material in the vault, so
hiding them from their own author would be the wrong trade. They appear on the
local dashboard tagged as non-travelling. The tag is the control: it is what
stops one being carried into a client instance later, and it only works if it is
attached from the first commit rather than added when a boundary appears.

### `CLAUDE.md` and `prd.md` are updated, framing only

Both described the older, narrower product.

- `CLAUDE.md`: the header no longer opens as an ETHOnline build with a passed
  deadline. It now says what the tool is, records that it started at ETHOnline
  2026 and outgrew it, and points here for direction. **All 29 invariants are
  untouched**, verified by count.
- `prd.md`: a "wider problem" subsection added under Problem, one goal added
  (read history, name what is missing, recommend only), and one non-goal added
  (not a predictor of savings). The original vetting problem statement stays,
  because it is still true and still what the tool does today.
