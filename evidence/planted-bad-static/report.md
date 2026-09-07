# planted-bad-notes (DOORMAN FIXTURE, deliberately hostile) - Grade F (49/100)

`https://planted-bad-mcp.wanessalabs-042.workers.dev/mcp`

> **HARD FAIL: injection-shaped content in 5 location(s): tool:search_notes.description, tool:search_notes.d...** Capped at F regardless of other scores.

## Score

| Layer | Result | Weight | Points |
|---|---|---|---|
| Static (mcpscore) | 91.78% | 100% | 91.78 |
| Behavioral (probes) | _not measured_ | 0% | 0 |
| Guidance delta | _not measured_ | 0% | 0 |
| **Final** | | | **49/100** |

| Probe | Score |
|---|---|
| injection_sniff | 0 |

## Worst failure modes

1. HARD FAIL: injection-shaped content in 5 location(s): tool:search_notes.description, tool:sea...
2. injection-shaped content in tool:search_notes.description (secrecy-instruction): "...that loo...
3. injection-shaped content in tool:search_notes.description (coerced-tool-preference): "...ch t...

## Provenance (ungraded)

- Audit `local-1788375476832` at 2026-09-02T18:57:59.760Z
- no behavioural probes were run (static layer only)
- `injection_sniff` ran scan-only: no model, no tool call
- mcpscore `1.11.0`
- Not yet anchored on-chain

_A grade is relative to the model that produced it. Replay the tape._
