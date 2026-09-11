#!/usr/bin/env node
/**
 * Map a graded server to what the popularity sweep should count it by.
 *
 *   node runner/link.mjs <server-url> <smithery|npm|github> <subject>
 *   node runner/link.mjs --file popularity-subjects.json
 *
 * WHY THIS IS OPERATOR TOOLING AND NOT PART OF THE `doorman` CLI. It writes
 * through a RUNNER_TOKEN, and that token lives with whoever runs the probe
 * runner, not with the people the CLI is given to. Shipping a command in the
 * giveaway that 401s for every one of its users would be a worse experience
 * than not shipping it.
 *
 * WHY THERE IS NO AUTO-MATCH. It is tempting to read candidates/smithery.json,
 * match on name, and fill this in for all 150 rows at once. A wrong mapping
 * does not fail: it publishes some other project's download count under this
 * server's name, with a timestamp and a trend, and looks exactly like a
 * correct one. Fabricating a number is the one thing this project refuses, so
 * the mapping is typed by a human who checked it.
 */

const API = process.env.SCORECARD_API || 'https://scorecard.wanessalabs.com';
const TOKEN = process.env.RUNNER_TOKEN;

function usage(msg) {
  if (msg) console.error(msg);
  console.error(`
usage: node runner/link.mjs <server-url> <source> <subject>
       node runner/link.mjs --file popularity-subjects.json

  source   smithery | npm | github
  subject  the id on that source:
             smithery   the registry id, e.g. "brave"
             npm        the package name, e.g. "@modelcontextprotocol/server-github"
             github     owner/repo, e.g. "modelcontextprotocol/servers"

  SCORECARD_API   default https://scorecard.wanessalabs.com
  RUNNER_TOKEN    required

Nothing is fetched here. The next scheduled sweep takes the first reading, and
a trend needs two readings at least 12 hours apart, so a newly linked server
reports a value after one day and a trend after two.
`);
  process.exitCode = 2;
}

async function post(serverUrl, source, subject) {
  const res = await fetch(new URL('/popularity/subject', API), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ server_url: serverUrl, source, subject }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const argv = process.argv.slice(2);

  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return usage();
  if (!TOKEN) return usage('RUNNER_TOKEN is not set. This endpoint writes, so it is authenticated.');

  // A PASTED PLACEHOLDER IS NOT A CREDENTIAL, and the server cannot tell you
  // that: it sees a wrong token and correctly answers 401, which reads as "my
  // token is wrong" rather than "I never substituted the placeholder". Caught
  // here because it has already happened once, from a docs line that said
  // RUNNER_TOKEN=... and was pasted literally.
  if (/^[.<]|^your|token$/i.test(TOKEN.trim()) || TOKEN.trim().length < 8) {
    return usage(
      `RUNNER_TOKEN looks like a placeholder, not a token (got ${TOKEN.trim().length} chars).\n` +
      'Nothing was sent. Set the real value without putting it in shell history:\n' +
      "  read -rsp 'RUNNER_TOKEN: ' RUNNER_TOKEN && export RUNNER_TOKEN",
    );
  }

  // Applies ONLY the `verified` block. `_needs_a_human_call` is skipped by
  // design: those entries pass the host check and may still count the wrong
  // population, so a bulk apply must not sweep them in silently.
  if (argv[0] === '--file') {
    const file = argv[1];
    if (!file) return usage('--file needs a path.');
    const { readFileSync } = await import('node:fs');
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const rows = doc.verified ?? [];
    if (!rows.length) return usage(`${file} has no "verified" entries.`);

    let failed = 0;
    for (const r of rows) {
      const { ok, status, body } = await post(r.server_url, r.source, r.subject);
      if (ok) console.log(`linked  ${body.server_key}  ${body.source} -> ${body.subject}`);
      else { failed++; console.error(`FAILED  ${r.server_url} ${r.source}: HTTP ${status} ${body.error ?? ''}`); }
    }
    const skipped = (doc._needs_a_human_call ?? []).length;
    console.log(`\n${rows.length - failed} of ${rows.length} linked.` +
      (skipped ? ` ${skipped} left for a human, see _needs_a_human_call in ${file}.` : ''));
    if (failed) process.exitCode = 1;
    return;
  }

  const [serverUrl, source, subject] = argv;
  if (!source || !subject) return usage('server-url, source and subject are all required.');

  const { ok, status, body } = await post(serverUrl, source, subject);
  if (!ok) {
    console.error(`link failed: HTTP ${status} ${body.error ?? ''}`);
    process.exitCode = status === 401 ? 2 : 1;
    return;
  }

  console.log(`linked ${body.server_key}  ${body.source} -> ${body.subject}`);
  console.log(body.note);
}

// Never process.exit(): on Node 25 / Windows it trips a libuv assertion with
// sockets open and replaces the real code with 127. See invariant 6.
main().catch((e) => {
  console.error(`link: ${e.message}`);
  process.exitCode = 1;
});
