# Community signal

A build brief. What an install may contribute back, what it may never
contribute, and why the aggregate is not allowed to touch a grade.

Status: implemented on `feat/doorman-community-signal`. Not deployed.

---

## The problem this solves

Doorman already has a community read path and it is the good half. `GET /feed`
publishes one row per graded server, anonymous and free, so a candidate is
graded once and every install reads that grade for nothing. `doorman watch`
fetches it and does the matching locally, against an inventory that never
leaves the machine.

There is no write path. The only way anything an install learns reaches the
service is a human deciding to type `/vet <url>`. So the service knows what it
has graded and knows nothing about what anyone wanted and could not find.

That gap has a specific cost. `doorman needs` already computes, locally, the
single most valuable fact in the product: a capability this build keeps asking
for that **nothing graded covers**. Invariant 29 requires it to be printed
rather than dropped. Today it is printed to one terminal and discarded.

Aggregate that line across installs and it becomes the grading queue, ordered
by demand rather than by whatever anyone happened to submit.

## What may be contributed

Two things, both counts over a closed vocabulary.

| Signal | Shape | Where it comes from |
|---|---|---|
| **gap** | one taxonomy id from `NEEDS` | `doorman needs`, where `gap: true` |
| **blocked** | one server name the gate refused | the gate's own refusal, `mcp__<name>__<tool>` |

Nothing else. No counts of how often, no URLs, no prose, no inventory, no
identity, no timestamps finer than a day.

### Why the vocabulary is closed, and who owns it

The client sends taxonomy ids. The **Worker** validates them against a
vocabulary it owns and **names every term it dropped** in the response.

The alternative was to ship the list twice and trust the copies to agree.
Invariant 2 already refuses that shape for grade math, for the reason that
applies here unchanged: two implementations drift, and a drifted vocabulary
silently discards valid contributions. One authority, and drift surfaces as a
refusal the contributor can read.

### Why prompts can never be in the payload

`needs.mjs` states it in its own header: the prompts never leave the machine.
Invariant 28 exists because 1548 of 1656 `user` records in a real transcript
directory are tool results, hook attachments and expanded slash-command
bodies. A free-text field on this endpoint would therefore ship the
contributor's files to a server, under a feature described as telling us what
you were missing.

So the payload carries the taxonomy id that matched, never the sentence that
matched it.

A server **name** is different and is deliberately allowed. It is what the
gate can see and all it can see, it is already published by whoever wrote the
MCP config, and it is the only readout of what people are trying to install
that nobody has graded.

## What the aggregate is not

**It rides along and never mixes in.** A demand count is not evidence about
quality. It goes beside the grade, never inside the score, and no layer
weight, band or hard-fail reads it.

This is not a new rule. `feed.ts` already reasons this way about popularity:

> They answer different questions: the grade is what happened when an agent
> drove the server, and popularity is how many people installed it without
> asking that. A popular F is the most useful row this feed can carry.

Demand is the third thing on that shelf. It answers "how many builds wanted
this", which is not "is it any good".

Holding that line is what keeps the PRD's non-goal true. There is still no
central verdict: the allowlist stays local, owned by the human running the
gate, and this endpoint cannot change what any gate allows.

It also bounds the damage from gaming. Anonymous counts can be inflated by
anyone willing to send requests. Because they can only ever reorder a queue of
what to grade next, an inflated count buys an attacker an audit they could
have requested directly through `POST /grade` anyway. If these numbers were
ever allowed near a grade, the same inflation would buy a reputation.

## Decisions taken

**Anonymous, permanently.** No account, no install id, no key. A contribution
is a count with no contributor attached. This rules out reputation and
per-install history for good, and it is the reason the endpoint needs no
privacy policy beyond the one sentence it prints.

**The aggregate is public.** `GET /signals` is free and unauthenticated like
every other read here. A demand list visible only to contributors would make
the first useful thing this project produces conditional on giving something
up.

**Opt-in, off by default, and it prints the payload.** `doorman contribute`
sends nothing without `--send`. The default run prints the exact JSON. That is
not a courtesy, it is the only reason anyone should turn it on.

**Day granularity.** Counts are bucketed per term per UTC day. Finer buckets
are a timing channel over a small population, and nothing downstream needs an
hour.

## The contract

### `POST /signal`

Open and anonymous, like `POST /grade`. Charged through the same
`admitRequest` limiter, one item per term, fails closed.

```json
{
  "gaps": ["browser-automation", "observability"],
  "blocked": ["some_server_name"],
  "client_version": "0.2.1"
}
```

Response names what was counted and what was dropped:

```json
{
  "ok": true,
  "counted": { "gaps": 2, "blocked": 1 },
  "dropped": [{ "value": "teleportation", "why": "not in the vocabulary" }],
  "day": "2026-09-22",
  "note": "Counts only. No prompt text, no urls and no identity were stored."
}
```

A payload that is entirely unknown terms is **200 with everything dropped**,
never 400. The contributor ran a newer client than the deployment knows about,
and refusing the whole request would tell them nothing about which term was
the problem.

### `GET /signals`

```json
{
  "vocabulary": ["docs-lookup", "web-search", "..."],
  "gaps": [{ "term": "browser-automation", "reports": 23, "first_seen": "2026-09-14" }],
  "blocked": [{ "name": "some_server_name", "reports": 9, "first_seen": "2026-09-18" }],
  "note": "Reports, not installs. One build may report the same gap on many days."
}
```

`reports` is deliberately not called `builds`. Nothing here can count builds,
because nothing here knows who is asking, and a field named `builds` would be
a number the service cannot support.

### Table

```sql
CREATE TABLE signal_count (
  kind  TEXT NOT NULL,          -- 'gap' | 'blocked'
  term  TEXT NOT NULL,
  day   TEXT NOT NULL,          -- UTC date, YYYY-MM-DD
  n     INTEGER NOT NULL,
  PRIMARY KEY (kind, term, day)
);
```

One row per term per day, upserted. The table grows with the vocabulary and
the calendar, not with traffic.

## What this does not build

- No identity, no reputation, no per-install history.
- No effect on any grade, band, weight or hard-fail.
- No automatic contribution. A scheduled contribute is a thing an operator can
  wire up; the CLI will not do it for them.
- No free-text channel, in either direction, ever.
- **No "is anything graded for this gap yet" field.** Which graded servers
  cover which capability is decided by the `catalog` terms in the client's own
  taxonomy, on the client, against the client's inventory. The Worker does not
  have that mapping, and a field it filled in by guessing would be a confident
  wrong answer about coverage. The client already computes it correctly and
  locally; that is where it stays.
