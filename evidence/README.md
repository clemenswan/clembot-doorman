# evidence

Real audit bundles. Committed as proof, never hand-edited. If a number here
disagrees with a number in a doc, this directory is right.

| Bundle | Server | Grade | Static | Why it is here |
|---|---|---|---|---|
| `deepwiki-static/` | `mcp.deepwiki.com/mcp` | A 85.71 | 78/91 = 85.71% | A real third-party server that passes |
| `scorecard-self/` | this service | A 98.63 | 72/73 = 98.63% | We grade ourselves and publish it |
| `planted-bad-static/` | our fixture | F 49 | 67/73 = **91.78%** | Better configured than the A, and hostile |

The set is the argument. The hostile fixture is the BEST configured of the
three. One of them is telling the reading agent to ignore its instructions, and
no amount of reading the config would tell you which.

`scorecard-self/` is here because a grader that never grades itself is asking
for trust it will not give anyone else. It fails exactly one static rule,
`capability_tools_list_changed`, and fails it on purpose: we do not emit those
notifications and will not claim a capability we do not have to buy a point.

## What a bundle contains

| File | What it is |
|---|---|
| `grade.json` | The `GradeResult`. Layer percentages, weights after renormalisation, hard fail, worst failure modes. |
| `report.md` | The one-page human artifact. Truncates its own sections to stay one page and says so when it had to. |
| `recipe.md` | Rules drafted from the audit, each traced to an observed failure. |
| `transcripts.jsonl` | The tape. Every turn, verbatim, never truncated and never sampled. |
| `evidence.sha256` | SHA-256 over the canonicalised bundle. |

## These are local runs, and the hashes will not match the service

Both bundles were produced by `runner/run.mjs --once`, which assigns a local
audit id. The hash covers the whole bundle **including that id**, so the
service's audit of the same server on the same day has a different hash by
construction. Neither is wrong. If you want the service's copy, ask the
service:

```
GET /grade/{audit_id}                # the grade
GET /grade/{audit_id}/transcripts    # the tape, unauthenticated
```

The registry files in `doorman/registry/` cite the **service** audit ids and
hashes, because that is what a user's poller would sync.

## Both are partial audits, and say so

No `ANTHROPIC_API_KEY` has been supplied, so the four model-driven probes have
never run. What ran is the static layer plus `injection_sniff`, which is
scan-only and needs no model. The behavioural layer comes back `null`, the
weights renormalise over what was measured, and every report's provenance
section states it. An unmeasured layer is never scored zero.

## Reproducing

```bash
export PATH="$PATH:<python>/Scripts"          # mcpscore must be on PATH
cd mcp-scorecard
node runner/run.mjs --once --static-only \
  --server https://mcp.deepwiki.com/mcp \
  --needed-for "look up how a repo works" \
  --out ../evidence/deepwiki-static
```

The grade should reproduce exactly. The hash will not, because the audit id
moves.
