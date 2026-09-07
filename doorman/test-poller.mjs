#!/usr/bin/env node
/**
 * Tests for the registry key derivation.
 *
 * This exists because the first implementation had a trust-collision bug that
 * every end-to-end test happily ignored: it keyed servers by the first label
 * of the hostname, so every `mcp.<vendor>.com` server in the world collapsed
 * onto the single key `mcp`.
 */

import { serverKey } from './scripts/poller.mjs';

let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}${detail ? ' - ' + detail : ''}`); fail++; }
};

console.log('\npoller: registry key derivation\n');

// The bug, stated as a test.
const a = serverKey('https://mcp.deepwiki.com/mcp');
const b = serverKey('https://mcp.some-attacker.example/mcp');
check('two different mcp.* vendors do NOT collide', a !== b, `${a} vs ${b}`);
check('key keeps the whole hostname', a === 'mcp-deepwiki-com', a);

check('distinct hosts give distinct keys',
  serverKey('https://a.example.com/mcp') !== serverKey('https://b.example.com/mcp'));

check('same host is stable across paths',
  serverKey('https://mcp.deepwiki.com/mcp') === serverKey('https://mcp.deepwiki.com/other'));

check('case is normalised', serverKey('https://MCP.DeepWiki.com/mcp') === 'mcp-deepwiki-com');

check('subdomain depth is preserved',
  serverKey('https://a.b.c.example.com/mcp') === 'a-b-c-example-com');

// A key is used as a JSON object key and matched literally by the gate's
// grep, so it must never contain regex or JSON metacharacters.
for (const url of [
  'https://ok.example.com/mcp',
  'https://a.b.example.com/mcp',
  'not-a-url-at-all',
  'https://weird_host.example.com/mcp',
]) {
  const k = serverKey(url);
  check(`key is safe for '${url}'`, /^[a-z0-9_-]*$/.test(k), k);
}

check('a garbage url still yields something inert', /^[a-z0-9_-]*$/.test(serverKey('}{"x":1}')));

console.log(`\n  ${fail === 0 ? 'POLLER TESTS PASSED' : `POLLER TESTS FAILED (${fail})`}\n`);
process.exitCode = fail === 0 ? 0 : 1;
