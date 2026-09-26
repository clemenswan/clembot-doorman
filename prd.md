---
project: clembot-doorman
cluster: agency
status: production
blocked: false
updated: 2026-09-24
---

# Clembot Doorman - PRD

## Problem

Adding an MCP server to an agent is one line of configuration. After that line,
a server nobody has audited describes its own tools to the agent, and the agent
acts on the description. There is no grade, no gate, and no record.

The existing tooling reads manifests. `mcpscore` is good at exactly that: it
catches a missing field, a stale protocol version, an invalid schema. It cannot
catch the failure that actually costs an operator time, which is an agent picking
the wrong tool because two descriptions say nearly the same thing, or burning
three turns on an error message that never names the field it is complaining
about.

Nobody grades an MCP server by using it.

### The wider problem, added 2026-09-17

Vetting is the half that was built first, and it answers "should I install this
thing I already found". The question an operator asks earlier is **what should I
install at all**, and nothing above answers it.

A build's own prompt history holds that answer. What a team keeps reaching for
and does not have is a measurable gap, evidenced by a count of their own
sentences rather than a guess about their intentions. `doorman needs` already
reads exactly that.

So the product is **provisioning**, and vetting is what keeps provisioning safe:
the reason to trust an installer, not the reason to want one. Direction,
decisions and open questions live in `positioning.md`.

## Who this is for

**Primary:** a developer running Claude Code who wants to add a third-party MCP
server and has no basis for deciding whether to. Today the choice is "read the
README and hope" or "do not add it".

**Secondary:** the author of an MCP server who wants to know why agents struggle
with it. The failure modes this produces are specific and fixable, and the recipe
is a work-around they can turn into a fix.

## Goals

1. Produce a defensible grade for an arbitrary MCP server, where "defensible"
   means every number traces to a recorded observation a sceptic can replay.
2. Block ungraded servers at the point of use, deterministically and offline.
3. Draft a usage recipe from observed failures, so a C-grade server becomes
   usable rather than merely labelled.
4. Make the evidence tamper-evident: one hash over the grade and every transcript.
5. Read a build's own history and name what it is missing, ranked by spend
   already incurred, recommending only. Added 2026-09-17.
6. Grade the harness itself, not only the servers it installs: 7 dimensions, 10
   checks, a receipt (a file and a line, or `absent`) on every finding, and an
   overall band that is the WORST dimension rather than the average. Surface reads
   only, fails closed. `--sow` turns the open findings into work packages.
   Added 2026-09-23, PR #137. Contract: `docs/harness-report.md`.

   This is a grade, so it supersedes the "recommending only" scope in goal 5 for
   the harness half. Goal 5 still describes `doorman needs`, which ranks and
   recommends and does not score.

## Non-goals

- **Not a security scanner.** The injection sniff is scan-only and detects
  instruction-shaped text. It does not attempt exploitation and does not claim to
  find vulnerabilities.
- **Not a replacement for `mcpscore`.** It wraps it. The static layer is 30 points
  of a 100-point grade, deliberately the smallest.
- **Not a live proxy.** It grades a server at a point in time. It does not sit in
  the request path.
- **Not a universal trust authority.** The allowlist is local and owned by the
  human running the gate. There is no central verdict.
- **Not a predictor of savings.** Recommendations are ranked by spend already
  incurred, never by a projected saving. A saving becomes claimable only once an
  adoption has a measured before and after. Added 2026-09-17.

## Success metrics

| Metric | Target | Status 2026-09-01 |
|---|---|---|
| Grades a real public MCP server end to end | yes | **met** (DeepWiki, static layer, 85.71 A) |
| Grade math verified against mutation | every layer rule | **met** (3 of 3 mutants caught) |
| Gate blocks an unknown server | yes | **met** (29 adversarial tests, 5 of 5 mutants caught) |
| Gate makes zero network calls | zero | **met** (asserted statically) |
| Behavioural probes run against a live model | 5 probes x 3 runs | **NOT met** (no API key supplied) |
| Evidence hash is reproducible | byte-stable | **met** (canonical serialisation, tested) |
| On-chain anchor | real tx | **NOT met** (stub that refuses to claim success) |

## Key decisions

**Grading is asynchronous, and the API says so.** A Cloudflare Worker cannot run
`mcpscore`: it is Python with native compiled dependencies, and Workers cannot
spawn a process. `POST /grade` returns 202 and an audit id. The alternative was
to pretend to be synchronous and time out.

**One isomorphic grade module, imported by both halves.** The runner imports the
built artifact rather than reimplementing the math. Two implementations would
drift, and a laptop-produced grade would stop meaning the same thing as a
Worker-produced one.

**An unmeasured layer is excluded, not zeroed.** Weights renormalise over the
layers that ran. Scoring an unrun layer as zero would fail honest partial audits.

**The gate reads a local file and never the network.** A gate that depends on a
service fails open when the service is down. The service publishes; a human syncs;
the gate reads what the human accepted.

**The doorman subagent gets exactly one MCP tool.** The agent adjudicating trust
must not hold capabilities an untrusted server could talk it into using.

## Open questions

1. Bazantic fee model, supported chains, recipe format. Unverified from inside
   the product.
2. ETHGlobal Continuity Track rules on pre-existing code.
3. Hedera against 0G for anchoring. The anchor is currently a stub that returns
   `anchored: false` and a null tx, so nothing downstream can mistake it for real.
4. x402 client library choice for the wallet.
5. Whether the guidance-delta layer survives the schedule. It is the first cut in
   the documented cut order.
