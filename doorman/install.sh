#!/usr/bin/env bash
#
# Install the doorman into a project, then PROVE it works there.
#
# The gate has its own test suite, and that suite proves the gate works in this
# repo. It says nothing about whether the copy sitting in your project resolves
# its registry, reads its lists, and blocks. A security control that was
# installed slightly wrong looks exactly like one that is working: quiet.
#
# So this script ends by driving the INSTALLED gate at its INSTALLED path and
# checking all four outcomes. If any of them is wrong it exits non-zero and says
# the install is not safe to rely on, rather than printing a tick.
#
# What it deliberately does NOT do:
#
#   - It never edits your settings.json. Merging JSON in bash without jq is how
#     a config gets silently clobbered, and the gate is dependency-free on
#     purpose. It detects whether the hook is wired and prints the exact block.
#   - It never overwrites an existing registry. That file is your trust list,
#     built by hand over time, and replacing it with our three entries would be
#     the most destructive thing this script could do.
#
# Usage:
#   ./install.sh <path-to-your-project>
#   ./install.sh <path-to-your-project> --dry-run
#
# Requires: bash. Nothing else. No node, no jq, no network.

set -uo pipefail

SRC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-}"
DRY=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY=1; done

say()  { printf '%s\n' "$*"; }
warn() { printf '  !  %s\n' "$*" >&2; }
die()  { printf '\nerror: %s\n\n' "$*" >&2; exit 1; }

if [ -z "$TARGET" ] || [ "$TARGET" = "--dry-run" ]; then
  die "usage: ./install.sh <path-to-your-project> [--dry-run]"
fi
[ -d "$TARGET" ] || die "no such directory: $TARGET"
TARGET="$(cd -- "$TARGET" && pwd)"
[ "$TARGET" = "$SRC" ] && die "that is this repo. Point it at the project you want to protect."

say ""
say "  doorman -> $TARGET"
[ "$DRY" = 1 ] && say "  (dry run: nothing will be written)"
say ""

# ── 1. Copy ──────────────────────────────────────────────────────────────────
#
# Four things, and only one of them is allowed to be skipped: the registry,
# because an existing one is yours.

copy() {                      # copy <relative-src> <relative-dest-dir>
  local from="$SRC/$1" to="$TARGET/$2"
  if [ "$DRY" = 1 ]; then
    say "  would copy   $1 -> $2/"
    return 0
  fi
  mkdir -p "$to" || die "cannot create $to"
  cp "$from" "$to/" || die "cannot copy $1"
  say "  copied       $1 -> $2/"
}

copy .claude/hooks/mcp-gate.sh .claude/hooks
copy agents/doorman.md   .claude/agents
copy commands/vet.md     .claude/commands

REGISTRY_KEPT=0
if [ -f "$TARGET/registry/allowlist.json" ]; then
  REGISTRY_KEPT=1
  say "  KEPT         registry/ already exists. Not touching it: that is your"
  say "               trust list, and ours has three entries in it."
elif [ "$DRY" = 1 ]; then
  say "  would copy   registry/ -> registry/"
else
  mkdir -p "$TARGET/registry" || die "cannot create $TARGET/registry"
  cp "$SRC/registry/allowlist.json" "$SRC/registry/denylist.json" "$TARGET/registry/" \
    || die "cannot copy the registry"
  : > "$TARGET/registry/ledger.jsonl"
  say "  copied       registry/ -> registry/"
fi

GATE="$TARGET/.claude/hooks/mcp-gate.sh"
[ "$DRY" = 1 ] || chmod +x "$GATE" 2>/dev/null

# ── 2. The hook wiring, which we will not do for you ─────────────────────────

SETTINGS="$TARGET/.claude/settings.json"
say ""
if [ -f "$SETTINGS" ] && grep -q 'mcp-gate.sh' "$SETTINGS" 2>/dev/null; then
  say "  hook         already wired in .claude/settings.json"
else
  if [ -f "$SETTINGS" ]; then
    warn "settings.json exists but does not mention mcp-gate.sh."
  else
    warn "no .claude/settings.json yet."
  fi
  say ""
  say "  Add this. Not doing it for you: merging JSON in bash is how a config"
  say "  gets silently clobbered, and this file is yours."
  say ""
  cat <<'JSON'
  {
    "hooks": {
      "PreToolUse": [{
        "matcher": "mcp__.*",
        "hooks": [{
          "type": "command",
          "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/mcp-gate.sh",
          "timeout": 5
        }]
      }]
    }
  }
JSON
  say ""
  say "  UNTIL YOU DO, THE GATE IS INSTALLED AND NOT RUNNING."
fi

if [ "$DRY" = 1 ]; then
  say ""
  say "  dry run complete. Nothing was written, and nothing was verified:"
  say "  verification drives the installed gate, and there is not one yet."
  exit 0
fi

# ── 3. Prove it ──────────────────────────────────────────────────────────────
#
# Four cases. Three of them are refusals, and a gate that refuses EVERYTHING
# would pass all three while being useless, so the allow case is not optional.
#
# The allow case runs against this repo's own registry rather than the target's,
# because after a KEPT registry we do not know what is on yours. That still
# tests the code path that matters: read a list, find a match, exit 0.

say ""
say "  verifying the INSTALLED gate at $GATE"
say ""

fails=0
probe() {                     # probe <expected-exit> <name> <tool> [env...]
  local want="$1" name="$2" tool="$3"; shift 3
  local out got
  out="$(printf '%s' "{\"tool_name\":\"$tool\",\"tool_input\":{}}" \
        | env "$@" bash "$GATE" 2>&1)"
  got=$?
  if [ "$got" = "$want" ]; then
    printf '  PASS  %s\n' "$name"
  else
    printf '  FAIL  %s (wanted exit %s, got %s)\n' "$name" "$want" "$got"
    printf '        %s\n' "$(printf '%s' "$out" | head -2)"
    fails=$((fails + 1))
  fi
}

probe 0 "an allowlisted server is allowed" mcp__scorecard__grade \
      "DOORMAN_REGISTRY_DIR=$SRC/registry"
probe 2 "a denylisted server is blocked" mcp__planted_bad__search_notes \
      "DOORMAN_REGISTRY_DIR=$SRC/registry"
probe 2 "an unknown server is blocked" mcp__zz_not_a_real_server_9f3a__search \
      "DOORMAN_REGISTRY_DIR=$TARGET/registry"
probe 2 "a missing registry blocks rather than opens" mcp__scorecard__grade \
      "DOORMAN_REGISTRY_DIR=$TARGET/registry-does-not-exist"

say ""
if [ "$fails" != 0 ]; then
  say "  $fails CHECK(S) FAILED. Do not rely on this install."
  say "  The files are in place but the gate is not behaving. Most likely the"
  say "  registry did not land next to .claude/, which is where the gate looks:"
  say "  it resolves \$hook/../../registry, never a git root."
  exit 1
fi

say "  4/4. The gate is installed and behaving."
say ""
if [ "$REGISTRY_KEPT" = 1 ]; then
  say "  Your registry was left alone, so what is trusted has not changed."
else
  say "  Three servers are trusted, and they are ours. Everything else your"
  say "  agent reaches for will be blocked until you grade it: /vet <url>"
fi
say ""
