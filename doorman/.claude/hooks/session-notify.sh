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
RESOLVE="$HERE/../../scripts/resolve-cli.sh"

# 1. Say what is already known. Reading is destructive: consume-once is what
#    stops the same three servers being announced every morning until they are
#    furniture. `notify consume` does the delete.
if [ -f "$DIGEST" ]; then
  CLI=""
  [ -x "$RESOLVE" ] && CLI="$(bash "$RESOLVE" 2>/dev/null || true)"
  if [ -n "$CLI" ] && [ "$CLI" != "NOT_FOUND" ]; then
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
  if [ -z "$CLI" ] && [ -x "$RESOLVE" ]; then
    CLI="$(bash "$RESOLVE" 2>/dev/null || true)"
  fi
  if [ -n "$CLI" ] && [ "$CLI" != "NOT_FOUND" ]; then
    LOG="$PROJECT_DIR/.doorman/notify.log"
    mkdir -p "$PROJECT_DIR/.doorman" 2>/dev/null || true
    nohup $CLI notify refresh --root "$PROJECT_DIR" >"$LOG" 2>&1 &
    disown 2>/dev/null || true
  fi
fi

exit 0
