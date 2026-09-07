/**
 * Fetching instruction text.
 *
 * Every test injects `fetch`, so the suite makes no network calls. The runner
 * is also executed once with `globalThis.fetch` replaced by a throw, which is
 * what actually proves it rather than this comment.
 */

import { check, describe, rejects } from './harness.mjs';
import {
  InstructionFetchError,
  MAX_INSTRUCTION_BYTES,
  fetchInstructions,
  instructionUrl,
} from '../src/instructions.mjs';

const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const notFound = { ok: false, status: 404, text: async () => '' };

/** Records what was requested, answers from a map of url -> response. */
function stubFetch(map) {
  const asked = [];
  const f = async (url) => {
    asked.push(url);
    const r = map[url];
    if (!r) return notFound;
    if (r instanceof Error) throw r;
    return r;
  };
  f.asked = asked;
  return f;
}

describe('instructions: resolving the text url');
{
  check('a repo resolves to the raw README',
    instructionUrl({ id: 'https://github.com/owner/repo' }).target ===
      'https://raw.githubusercontent.com/owner/repo/HEAD/README.md');
  check('a repo offers main and master as alternates',
    instructionUrl({ id: 'https://github.com/owner/repo' }).alternates.length === 2);
  // The ref stays in the path. raw.githubusercontent.com urls are
  // /{owner}/{repo}/{ref}/{path}, so dropping `main` yields a 404.
  check('a blob url resolves to that exact file, ref included',
    instructionUrl({ id: 'https://github.com/owner/repo/blob/main/docs/SKILL.md' }).target ===
      'https://raw.githubusercontent.com/owner/repo/main/docs/SKILL.md',
    instructionUrl({ id: 'https://github.com/owner/repo/blob/main/docs/SKILL.md' }).target);
  check('a blob url on a non-default branch keeps that branch',
    instructionUrl({ id: 'https://github.com/o/r/blob/v2/SKILL.md' }).target ===
      'https://raw.githubusercontent.com/o/r/v2/SKILL.md');
  check('a gist resolves to its raw endpoint',
    instructionUrl({ id: 'https://gist.github.com/me/abc' }).target ===
      'https://gist.github.com/me/abc/raw');
  check('a plain md url resolves to itself',
    instructionUrl({ id: 'https://example.test/a.md' }).target === 'https://example.test/a.md');
  check('a local path is a file read, not a fetch',
    instructionUrl({ id: './x.md' }).kind === 'file');
}

describe('instructions: fetching');
{
  const f = stubFetch({ 'https://example.test/a.md': ok('# Hello') });
  const r = await fetchInstructions({ id: 'https://example.test/a.md' }, { fetch: f });
  check('returns the body', r.text === '# Hello', r.text);
  check('records where it came from', r.source === 'https://example.test/a.md');
  check('reports the byte count', r.bytes === 7, String(r.bytes));
  check('a short document is not truncated', r.truncated === false);
}
{
  // HEAD is missing, main answers. A repo whose default branch is not HEAD
  // must not be reported as unfetchable.
  const f = stubFetch({
    'https://raw.githubusercontent.com/o/r/main/README.md': ok('# From main'),
  });
  const r = await fetchInstructions({ id: 'https://github.com/o/r' }, { fetch: f });
  check('falls through to the next branch name', r.text === '# From main', r.text);
  check('tried HEAD first', f.asked[0].includes('/HEAD/'), f.asked[0]);
  check('stopped once it succeeded', f.asked.length === 2, String(f.asked.length));
}
{
  const f = stubFetch({});
  const e = await rejects(() => fetchInstructions({ id: 'https://github.com/o/r' }, { fetch: f }));
  check('every branch failing throws', e instanceof InstructionFetchError, String(e));
  check('the error lists what it tried', /HEAD.*main.*master/s.test(e.message), e.message);
}
{
  const f = stubFetch({ 'https://example.test/a.md': new Error('socket hang up') });
  const e = await rejects(() => fetchInstructions({ id: 'https://example.test/a.md' }, { fetch: f }));
  check('a transport error is reported, not swallowed',
    /socket hang up/.test(e.message), e.message);
}
{
  const r = await fetchInstructions(
    { id: './fake.md' },
    { readFile: () => '# local file' },
  );
  check('a local path is read from disk', r.text === '# local file', r.text);
  const e = await rejects(() => fetchInstructions(
    { id: './missing.md' },
    { readFile: () => { throw new Error('ENOENT'); } },
  ));
  check('an unreadable local path throws', e instanceof InstructionFetchError, String(e));
}

describe('instructions: the size cap is announced');
{
  const big = 'x'.repeat(MAX_INSTRUCTION_BYTES + 5000);
  const f = stubFetch({ 'https://example.test/big.md': ok(big) });
  const r = await fetchInstructions({ id: 'https://example.test/big.md' }, { fetch: f });
  check('an oversized document is capped', r.text.length === MAX_INSTRUCTION_BYTES,
    String(r.text.length));
  // The one that matters. A scanner reporting "clean" over a silently clipped
  // document is claiming something about text it never read.
  check('truncation is flagged so the report cannot claim a full scan',
    r.truncated === true);
  check('the original size is preserved for the report',
    r.bytes === big.length, String(r.bytes));
}
