# DeepWiki - Grade A (85.71/100)

`https://mcp.deepwiki.com/mcp`

> Graded by being used, not by being read.

## Score

| Layer | Result | Weight | Points |
|---|---|---|---|
| Static (mcpscore) | 85.71% | 100% | 85.71 |
| Behavioral (probes) | _not measured_ | 0% | 0 |
| Guidance delta | _not measured_ | 0% | 0 |
| **Final** | | | **85.71/100** |

| Probe | Score |
|---|---|
| injection_sniff | 100 |

## Worst failure modes

1. [MEDIUM] protocol_version_latest: Not using the latest protocol version: negotiated '2025-11-...
2. [MEDIUM] server_title_present: Server title is not present in server info
3. [MEDIUM] tools_annotations_present: Number of tools without behavior annotations: 3

## Provenance (ungraded)

- Audit `local-1788375473492` at 2026-09-02T18:57:56.680Z
- no behavioural probes were run (static layer only)
- `injection_sniff` ran scan-only: no model, no tool call
- mcpscore `1.11.0`
- Not yet anchored on-chain

_A grade is relative to the model that produced it. Replay the tape._
