#!/usr/bin/env bash
#
# Print how to invoke the doorman CLI on this machine, or NOT_FOUND.
#
# WHY THIS EXISTS. Installing the plugin does not install the CLI, and the
# plugin's own commands (`/doorman`, `/vet`) shell out to it. A plugin-only user
# therefore got `doorman: command not found` from the first thing they tried,
# which is a hard dependency the plugin never declared.
#
# It turns out the dependency is unnecessary: the installed plugin directory
# already contains `cli/doorman.mjs`, because the plugin IS the repo. So there
# are two ways to run it and this picks whichever exists:
#
#   1. `doorman` on PATH            a global `npm i -g`, if the user did one
#   2. the plugin's own copy        resolved from installed_plugins.json
#
# Order matters: a global install is the one the user chose and may be newer
# than the plugin cache, so it wins.
#
# Prints one line, suitable for `$(...)`. Never writes anything.

set -uo pipefail

DOORMAN="$(command -v doorman 2>/dev/null || true)"

if [ -z "$DOORMAN" ]; then
  # Read the harness's own record rather than guessing at a cache layout, and
  # match on content, because that file's shape is the harness's business.
  CLI="$(node -e '
    const fs = require("fs"), path = require("path");
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const rec = path.join(home, ".claude", "plugins", "installed_plugins.json");
    let out = "";
    try {
      const j = JSON.parse(fs.readFileSync(rec, "utf8"));
      const seen = new Set();
      (function walk(o) {
        if (o && typeof o === "object") {
          if (typeof o.installPath === "string") seen.add(o.installPath);
          for (const k of Object.keys(o)) walk(o[k]);
        }
      })(j);
      for (const p of seen) {
        const c = path.join(p, "cli", "doorman.mjs");
        if (/clembot-doorman/i.test(p) && fs.existsSync(c)) { out = c; break; }
      }
    } catch { /* no record, no plugin, or unreadable: fall through to NOT_FOUND */ }
    process.stdout.write(out);
  ' 2>/dev/null || true)"
  [ -n "$CLI" ] && DOORMAN="node $CLI"
fi

if [ -z "$DOORMAN" ]; then
  echo "NOT_FOUND"
  exit 1
fi

echo "$DOORMAN"
