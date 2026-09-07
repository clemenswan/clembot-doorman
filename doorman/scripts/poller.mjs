#!/usr/bin/env node
/**
 * Registry poller.
 *
 * Watches the scorecard for audits that have completed and reports which ones
 * would change the local registry. It is the bridge between "the service knows
 * something" and "the gate acts on it".
 *
 * It DOES NOT write to the registry by default. The registry is what the
 * security gate reads, so a background process that silently edits it would
 * quietly hand the trust decision to a network service. That is exactly the
 * property the offline gate exists to prevent.
 *
 *   node scripts/poller.mjs --api https://scorecard.example.com --owner me
 *   node scripts/poller.mjs ... --write     # opt in, explicitly, per run
 *
 * The --write path still refuses to auto-allow anything that hard-failed.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideForNote, readNote } from '../src/reviews.mjs';
import { appendDecision, VAULT_SUBDIR } from '../src/note.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(HERE, '..', 'registry');

const args = parseArgs(process.argv.slice(2));
const API = (args.api ?? process.env.SCORECARD_API ?? '').replace(/\/+$/, '');
const OWNER = args.owner ?? process.env.SCORECARD_OWNER ?? 'anonymous';
const INTERVAL = Number(args.interval ?? 10) * 1000;
const WRITE = Boolean(args.write);

// Only run the CLI when invoked directly. Without this guard, importing
// serverKey for a test executes the whole poller as a side effect.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (!isMain) {
  // imported as a module: export only, do nothing
} else if (!API || args.help) {
  console.log(`
doorman registry poller

  --api URL        scorecard base url (or SCORECARD_API)
  --owner NAME     allowlist owner to follow (or SCORECARD_OWNER)
  --interval SEC   poll interval, default 10
  --once           check once and exit
  --write          APPLY changes to registry/*.json (default: report only)
  --reviews DIR    also read review notes and act on approved ones.
                   Defaults to $DOORMAN_VAULT_PATH/clembot-doorman/reviews.

Without --write this only tells you what changed. The registry governs a
security gate, so applying a change is an explicit, per-run decision.
`);
  process.exitCode = API ? 0 : 1;
} else {
  try {
    if (args.once) await tick();
    else for (;;) { await tick(); await sleep(INTERVAL); }
  } catch (e) {
    console.error(`\nerror: ${e.message}\n`);
    process.exitCode = 1;
  }
}

async function tick() {
  await tickReviews();
  const res = await fetch(`${API}/allowlist/${encodeURIComponent(OWNER)}`);
  if (!res.ok) {
    log(`allowlist fetch failed: HTTP ${res.status}`);
    return;
  }
  const remote = await res.json();

  const local = readJson(join(REGISTRY, 'allowlist.json'));
  const localDeny = readJson(join(REGISTRY, 'denylist.json'));

  const changes = [];

  for (const entry of remote.allow ?? []) {
    const key = serverKey(entry.server_url);
    if (!local.servers[key]) {
      changes.push({ list: 'allow', key, entry, why: 'newly graded' });
    } else if (local.servers[key].audit_id !== entry.audit_id) {
      changes.push({ list: 'allow', key, entry, why: 're-graded' });
    }
  }

  for (const entry of remote.deny ?? []) {
    const key = serverKey(entry.server_url);
    if (!localDeny.servers[key]) {
      changes.push({ list: 'deny', key, entry, why: 'newly denied' });
    }
  }

  if (changes.length === 0) {
    log('no registry changes');
    return;
  }

  for (const c of changes) {
    log(`${c.why}: ${c.key} -> ${c.list.toUpperCase()} (${c.entry.grade} ${c.entry.score ?? '?'})`);
  }

  if (!WRITE) {
    log(`${changes.length} change(s) NOT applied. Re-run with --write, or use /vet to review each one.`);
    return;
  }

  for (const c of changes) {
    const file = c.list === 'allow' ? 'allowlist.json' : 'denylist.json';
    const doc = c.list === 'allow' ? local : localDeny;

    // A hard fail must never be written into the allowlist, whatever the
    // remote says. The gate would then permit a server we KNOW is hostile.
    if (c.list === 'allow' && (c.entry.grade === 'F' || c.entry.hard_fail)) {
      log(`REFUSED to allowlist ${c.key}: grade ${c.entry.grade}, hard_fail ${c.entry.hard_fail ?? 'none'}`);
      continue;
    }

    doc.servers[c.key] = {
      decision: c.list,
      url: c.entry.server_url,
      grade: c.entry.grade,
      score: c.entry.score,
      model: c.entry.model,
      audit_id: c.entry.audit_id,
      evidence_sha256: c.entry.evidence_sha256 ?? null,
      graded_at: c.entry.updated_at,
    };
    doc.servers[c.key].mcp_client_name = null;
    doc.updated_at = new Date().toISOString();
    writeFileSync(join(REGISTRY, file), JSON.stringify(doc, null, 2) + '\n');
    log(
      `NOTE: '${c.key}' is keyed by hostname. The gate matches the name from your ` +
      `MCP client config, so rename this key to that name or the gate will keep blocking it.`,
    );
    appendLedger({
      ts: new Date().toISOString(),
      event: c.list === 'allow' ? 'allowlisted' : 'denied',
      server: c.key,
      grade: c.entry.grade,
      score: c.entry.score,
      audit_id: c.entry.audit_id,
      source: 'poller --write',
    });
    log(`wrote ${c.key} to ${file}`);
  }
}

/**
 * Act on review notes a human has decided.
 *
 * The vault belongs to the human: this READS notes and APPENDS to the decision
 * log of ones it acts on. It never edits or deletes anything else there.
 *
 * A hard-failed server is refused even when the note says approved, and the
 * refusal is written back into that note rather than only printed here, so the
 * record lives where the decision was made.
 */
async function tickReviews() {
  const dir = args.reviews
    ?? (process.env.DOORMAN_VAULT_PATH
        ? join(process.env.DOORMAN_VAULT_PATH, VAULT_SUBDIR)
        : null);
  if (!dir) return;

  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    log(`reviews: ${dir} is not readable, skipping`);
    return;
  }

  const local = readJson(join(REGISTRY, 'allowlist.json'));
  const localDeny = readJson(join(REGISTRY, 'denylist.json'));

  for (const f of files) {
    const path = join(dir, f);
    let note;
    try {
      note = readNote(path, readFileSync(path, 'utf8'));
    } catch (e) {
      log(`reviews: could not read ${f}: ${e.message}`);
      continue;
    }
    if (!note.readable) { log(`reviews: ${f} has no frontmatter, skipped`); continue; }

    const d = decideForNote(note, { allow: local, deny: localDeny });
    if (d.action === 'skip') continue;

    const stamp = new Date().toISOString();

    if (d.action === 'refuse') {
      // The one place a rule beats a human, so it is recorded in their file.
      log(`reviews: REFUSED ${f} - ${d.reason}`);
      appendDecision(path, `${stamp} · poller REFUSED to allowlist: ${d.reason}`);
      continue;
    }

    if (!d.key) {
      log(`reviews: ${f} approved but carries no mcp_name, so the gate has no key to match. ` +
          'Add `mcp_name: <the name in your MCP client config>` to the note.');
      appendDecision(path, `${stamp} · poller could not apply: no mcp_name on the note`);
      continue;
    }

    if (!WRITE) {
      log(`reviews: would ${d.action} ${d.key} (${d.reason}). Re-run with --write.`);
      continue;
    }

    const doc = d.action === 'allow' ? local : localDeny;
    const file = d.action === 'allow' ? 'allowlist.json' : 'denylist.json';
    doc.servers[d.key] = { ...d.entry, decision: d.action };
    doc.updated_at = stamp;
    writeFileSync(join(REGISTRY, file), JSON.stringify(doc, null, 2) + '\n');
    appendLedger({ ts: stamp, event: d.action === 'allow' ? 'allowlisted' : 'denied',
                   server: d.key, grade: d.entry?.grade ?? null,
                   audit_id: d.entry?.audit_id ?? null, source: 'review note' });
    appendDecision(path, `${stamp} · poller applied: ${d.action} as ${d.key} (${d.reason})`);
    log(`reviews: ${d.action} ${d.key} from ${f}`);
  }
}

/**
 * Registry key for a server URL.
 *
 * Uses the FULL hostname, dots to dashes. An earlier version took the first
 * label (`hostname.split('.')[0]`) to get a friendly short name, and that was
 * a trust-collision bug: a great many MCP servers are published at
 * `mcp.<vendor>.com`, so `mcp.deepwiki.com` and `mcp.some-attacker.com` both
 * collapsed to the key `mcp`. Allowlisting one would have silently allowlisted
 * the other.
 *
 * The gate looks servers up by the name configured in the MCP CLIENT, which
 * cannot be derived from a URL at all. So this key will usually NOT match, the
 * gate will block, and a human has to map it deliberately. That is the correct
 * failure: guessing produced the collision above, and blocking is safe.
 */
export function serverKey(url) {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/[^a-z0-9.-]/g, '').replace(/\./g, '-');
  } catch {
    return String(url).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
  }
}

function readJson(path) {
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (!doc.servers || typeof doc.servers !== 'object') doc.servers = {};
    return doc;
  } catch {
    return { version: 1, servers: {} };
  }
}

function appendLedger(record) {
  const path = join(REGISTRY, 'ledger.jsonl');
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    /* first entry */
  }
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(path, existing + sep + JSON.stringify(record) + '\n');
}

function log(m) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const n = argv[i + 1];
    if (n && !n.startsWith('--')) { out[k] = n; i++; } else out[k] = true;
  }
  return out;
}
