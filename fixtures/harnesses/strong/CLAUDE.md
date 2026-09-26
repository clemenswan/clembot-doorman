# Ledger service

Payments ledger. Read `HANDOFF.md` first, then `.claude/rules/security.md`.

## Session end

Run `/session-end`. It rewrites `HANDOFF.md` and appends to `lineage.md`,
which is the audit log for this repo. Never edit `lineage.md` by hand.

## Agents

- `migrator` writes migrations.
- `reviewer` reads a diff and returns findings.
- `backfill` runs one-off data repairs.
- `reporter` renders the weekly figures.
- `notifier` posts the weekly figures.

## Memory

`HANDOFF.md` carries session state. `decisions.md` is the decision log.
