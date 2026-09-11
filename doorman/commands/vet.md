---
description: Vet a candidate before an agent gets it. Fit review first (free), paid grade only if the system actually needs it. Usage: /vet <url|repo|path> [what you need it for]
---

Vet: $ARGUMENTS

**Three questions, in this order, and the order is the feature.** First: does
this system need it at all? Second: can it afford to find out? Both are free and
local. Only if both pass does anything get paid for.

## Steps

1. **Run it.** The flow is a program, not instructions, so the ordering cannot
   drift and the "no charge on a redundant candidate" guarantee is testable:

   ```bash
   cd doorman && node scripts/vet.mjs <candidate> --needed-for "<purpose>"
   ```

   Add `--type mcp-server|skill|repo` if detection guesses wrong, and
   `--dry-run` to run fit only and never construct a scorecard client.
   `--max-usdc` and `--max-usdc-day` override the spend caps for this run.

2. **Read the FIT block back to the human first**, before any grade. On
   `redundant` or `out-of-scope` the run stops there having spent nothing, and
   the overlaps are the answer: name what already covers the need. Do not
   suggest grading it anyway.

3. **Read the budget line too.** On `REFUSED  the spend cap said no`, report
   the cap and what it would take to raise it. Do not raise it yourself, and do
   not suggest a way around it: a cap the agent edits when it is inconvenient
   is not a cap. On `REFUSED  could not read the price`, say that the price was
   unreadable and that an unknown price is not a free one. Never guess a price.

4. **On `fits` or `needs-new-subagent`**, the paid grade runs only for an MCP
   server. A skill or a repo gets a fit review plus an injection scan of its
   instruction text and reports `behavioral grade: n/a - no tools to probe`.
   Never describe that as a grade, and never send one to the scorecard.

5. **A review note is written to the vault**, status `pending`. Say where it
   landed. If it fell back to `registry/reviews/`, say that too and say why.

6. **Then, and only then, propose the registry change as a diff:**

   - Band A or B, no hard fail  -> propose adding to `registry/allowlist.json`
   - Band C                     -> allowlist PLUS the drafted recipe to
                                   `recipes/<server>.md`, because a C means an
                                   agent needs the recipe to succeed
   - Band F, or any hard fail   -> propose `registry/denylist.json`

   Show the diff. Do not apply it. The human decides what the gate trusts.

## Never

- **Never let a human's approval override a hard fail.** The poller refuses it
  and logs the refusal into the note. Do not work around that by editing the
  registry by hand.
- **Never flip a note's `status` yourself.** `pending` is the resting state; a
  person changes it. Nothing in this flow auto-approves.
- **Never claim a grade for a skill or a repo.** They have no tools to drive, so
  a behavioural grade cannot exist for them.
- **Never advise bypassing the `mcp-gate` hook.**
- **Never raise a spend cap on the human's behalf**, and never suggest
  `--max-usdc` as a way past a refusal you triggered. Report the number and let
  them decide.
- **Never state a price the service did not give you.** If `GET /price` could
  not be read, the price is unknown, and unknown is not zero.
- Never edit `registry/allowlist.json` without showing the diff and getting an
  explicit yes.
