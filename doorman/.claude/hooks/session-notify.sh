#!/usr/bin/env bash
#
# SessionStart hook. The visible half of the push model.
#
# Prints a digest that is ALREADY ON DISK, then fires a detached refresh so the
# next session is current. It makes no network call itself, which is the whole
# design: a SessionStart hook that waits on a fetch makes every session start as
# slow as the worst network it has ever seen, and offline it makes them fail.
# The cost of this hook on a normal morning is one `test -f` and one `cat`.
#
# THIS IS NOT THE GATE. `mcp-gate.sh` is a security control and is offline,
# dependency-free, and fails CLOSED with exit 2. This is a notification and
# fails OPEN and silent: it always exits 0, and every failure path prints
# nothing. A notifier that can break a session start is worse than no notifier.
#
# ponytail: the refresh rides on session start, so the first session after
# install prints nothing (no digest yet) and news is at most one session stale.
# A background poller (`doorman watch --poll`, roadmap Phase 2) would close that
# gap and is not worth a daemon yet.

set -uo pipefail

# Never let this hook be the reason a session fails to start.
trap 'exit 0' ERR

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
DIGEST="$PROJECT_DIR/.doorman/notify.md"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# THREE LAYOUTS, and the second one used to be silently broken.
#
#   plugin      <plugin>/.claude/hooks/ -> ../../scripts/resolve-cli.sh
#   installed   <repo>/.claude/hooks/   -> resolve-cli.sh beside this file
#   override    $DOORMAN_CLI, for a clone that is neither
#
# Installed standalone, `../../scripts/` is the REPO's scripts directory, which
# belongs to the user and does not contain our resolver. The consume half then
# still worked, because it falls back to cat, and the refresh half quietly never
# ran: the digest was printed once and never regenerated. A push channel that
# stops pushing looks exactly like a week with no news.
resolve_cli() {
  if [ -n "${DOORMAN_CLI:-}" ]; then printf '%s' "$DOORMAN_CLI"; return; fi
  local r
  for r in "$HERE/resolve-cli.sh" "$HERE/../../scripts/resolve-cli.sh"; do
    if [ -r "$r" ]; then
      local out
      out="$(bash "$r" 2>/dev/null || true)"
      if [ -n "$out" ] && [ "$out" != "NOT_FOUND" ]; then printf '%s' "$out"; return; fi
    fi
  done
  printf ''
}

# 1. Say what is already known. Reading is destructive: consume-once is what
#    stops the same three servers being announced every morning until they are
#    furniture. `notify consume` does the delete.
if [ -f "$DIGEST" ]; then
  CLI="$(resolve_cli)"
  if [ -n "$CLI" ]; then
    $CLI notify consume --digest "$DIGEST" 2>/dev/null || true
  else
    # No CLI resolved. Print it anyway and remove it by hand rather than
    # holding news hostage to a resolution problem.
    cat "$DIGEST" 2>/dev/null || true
    rm -f "$DIGEST" 2>/dev/null || true
  fi
fi

# 2. Refresh for next time, detached.
#
# stdout and stderr MUST be redirected away from this process. A background
# child that inherits the hook's stdout keeps the pipe open, and the harness
# waits on the pipe rather than on the process, so an unredirected `&` turns a
# fire-and-forget into the exact session-start stall this design avoids.
if [ -z "${DOORMAN_NO_REFRESH:-}" ]; then
  CLI="${CLI:-}"
  [ -z "$CLI" ] && CLI="$(resolve_cli)"
  if [ -n "$CLI" ]; then
    LOG="$PROJECT_DIR/.doorman/notify.log"
    mkdir -p "$PROJECT_DIR/.doorman" 2>/dev/null || true
    nohup $CLI notify refresh --root "$PROJECT_DIR" >"$LOG" 2>&1 &
    disown 2>/dev/null || true
  fi
fi

exit 0
