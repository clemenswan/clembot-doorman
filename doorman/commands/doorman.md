---
description: The doorman front door. With no arguments it reports what is gating this build and what to do next. Usage: /doorman [allow <server> | check <url> | needs | status]
---

Doorman: $ARGUMENTS

You are the front door for clembot-doorman. `/vet` is the deep path for grading
a candidate; this is the one somebody reaches for when they do not yet know
which command they want, and most often when the gate has just blocked them.

## Preflight, before any branch below

Every branch here shells out to the `doorman` CLI, and **installing the plugin
does not put `doorman` on PATH**. It does not need to: the installed plugin
directory carries its own copy. Resolve it once, first, and use `$D` everywhere
below instead of a bare `doorman`:

```bash
D="$(bash "${CLAUDE_PLUGIN_ROOT:-.}/scripts/resolve-cli.sh")" && echo "$D"
```

That prints either a global `doorman`, or `node <plugin>/cli/doorman.mjs`,
whichever exists. A global install wins, because the user chose it and it may
be newer than the plugin cache.

If it prints `NOT_FOUND`, stop and tell the user this, then end the turn:

> The doorman CLI could not be located, from PATH or from the installed plugin.
> Reinstall the plugin, or install the CLI directly:
>
> ```bash
> npm i -g clembot-doorman
> ```
>
> The gate is still running either way. It is pure bash and depends on none of
> this, so nothing is unprotected. You just cannot inspect or change the trust
> list from here yet.

Do **not** try to work around a missing CLI by reading or editing registry
files by hand. The registry carries provenance fields (`basis`, `grade`,
`audit_id`) that `doorman allow` writes correctly and a hand-edit loses, and a
hand-written entry is indistinguishable from a measured one afterwards.

**Pick the branch from $ARGUMENTS. If it is empty, run `status`.**

## status (the default)

```bash
"$D" doctor .
```

Report, in this order, and stop after it:

1. Whether the gate is running, and **from where**. A user-scope plugin gates
   every project on the machine; a project install gates one. Those have
   different blast radius and the user needs to know which they have.
2. Which trust list is actually in force. The order is `$DOORMAN_REGISTRY_DIR`,
   then `<project>/registry`, then `~/.doorman/registry`, then the plugin
   default. Name the one being read, not all four.
3. How many servers it trusts, and how many of those were **graded** versus
   allowed by the operator. That ratio is the honest summary of the setup, and
   `basis` on each entry is where it comes from.

Then offer the next step that fits what you found, one line, no menu.

## allow <server>

The user has been blocked and wants the server through. They have a NAME, not
a url, because `mcp__<server>__<tool>` is all the gate can see.

```bash
"$D" allow <server>              # ~/.doorman/registry, every project
"$D" allow <server> --scope project   # ./registry, this project only
```

**Say what this is, every time, in one sentence:** it records a decision, not a
measurement. The entry is written with `basis: operator` and a null grade
because nothing graded the server. Never describe an allowed server as safe,
vetted, or approved. It is permitted.

Then offer the free measurement, once: `"$D" report <url>` needs no key.

If it refuses because the server is on a denylist, do NOT work around it. Read
the recorded reason back to the user and stop. A denial was earned by an audit.

## check <url>

```bash
"$D" report <url>
```

Free, keyless, no model. Report the score, whether anything hard-failed, and
the worst findings. Say plainly that this is the static layer: it describes
what the server implements and what its tool descriptions say to a model. It
does not say whether an agent can use it well, which is `doorman eval`.

## needs

```bash
"$D" needs .
```

Read this build's own prompts and report unmet capabilities against the graded
feed. Two things must survive into your summary: a match is `worth-measuring`
and never `fits`, and a `GAP` means nothing graded covers that need, which is a
hole in the catalogue rather than a fact about the user's build.

## dashboard

```bash
"$D" dashboard .            # this project's own history
"$D" dashboard . --vault    # every transcript directory in this workspace
```

Writes `.doorman/report.html` and opens it. It measures nothing of its own: it
renders what `audit` already produced, and grades the doctor half.

The recommendations panel is ordered by **tokens already processed** in the
sessions that asked for each capability, never by a projected saving. Four
things in it are load-bearing and must survive into any summary you write:

- **Tokens are not money.** A transcript carries no cost field, so the figure is
  every token those sessions moved, including context re-read each turn. It says
  "tokens processed" and never implies a price. CodeBurn owns cost.
- **The division is shown.** A session that matched three needs gives each a
  third, and the note beside the figure says so. A share presented as a
  measurement would be a number nobody took.
- **Counts and matched terms, never a prompt excerpt.** History holds client and
  personal material and the report is a file on disk.
- **A need with no candidate is a gap in the catalogue**, not a fact about the
  build, and the panel says which list it matched against.

`--vault` merges several transcript directories before de-duplication, so an ask
repeated across worktrees counts once. The panel states how many it read.

Dead weight is reported below the gaps: units installed that history never asked
for, and pairs answering the same need. It is reported, never recommended for
removal.

## Rules that outrank anything above

- **Never invent a grade, a score, or an audit id.** If it was not measured it
  is null, and you say so.
- **Never edit a registry by hand when `doorman allow` would do it.** The
  command writes the provenance fields; hand-editing loses them.
- **Never suggest disabling the gate to get past a block.** Allow the specific
  server, or leave it blocked.
