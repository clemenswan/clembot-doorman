/**
 * Candidate type detection.
 *
 * The consequential assertion in this file is the last section: a skill or a
 * repo must never be gradeable. Everything else is plumbing around that.
 */

import { check, describe } from './harness.mjs';
import {
  CANDIDATE_TYPES,
  CandidateError,
  candidateSlug,
  detectCandidate,
  mayBeGraded,
} from '../src/candidate.mjs';

const t = (input, opts) => detectCandidate(input, opts).type;
const throws = (fn) => {
  try { fn(); return null; } catch (e) { return e; }
};

describe('candidate: MCP servers');
{
  check('a plain https endpoint is an mcp server', t('https://mcp.deepwiki.com/mcp') === 'mcp-server');
  check('a bare host is an mcp server', t('https://example.test') === 'mcp-server');
  check('the host is captured', detectCandidate('https://MCP.Example.test/mcp').host === 'mcp.example.test');
}

describe('candidate: skills');
{
  check('a raw .md url is a skill', t('https://example.test/docs/SKILL.md') === 'skill');
  check('a gist is a skill', t('https://gist.github.com/someone/abc123') === 'skill');
  check('a github blob url is a skill, not a repo',
    t('https://github.com/owner/repo/blob/main/SKILL.md') === 'skill');
  check('a github raw url is a skill',
    t('https://github.com/owner/repo/raw/main/SKILL.md') === 'skill');
  check('a local .md path is a skill', t('./notes/my-skill.md') === 'skill');
  check('a windows .md path is a skill', t('C:\\work\\skill.md') === 'skill');
}

describe('candidate: repos');
{
  check('owner/repo is a repo', t('https://github.com/anthropics/claude-code') === 'repo');
  check('a trailing slash does not change it', t('https://github.com/anthropics/claude-code/') === 'repo');
  check('a deeper tree url is still a repo',
    t('https://github.com/owner/repo/tree/main/src') === 'repo');
}

describe('candidate: what it refuses to guess');
{
  check('an empty candidate throws', throws(() => detectCandidate('')) instanceof CandidateError);
  check('a bare word throws rather than guessing',
    throws(() => detectCandidate('deepwiki')) instanceof CandidateError);
  check('a non-md local path throws',
    throws(() => detectCandidate('./some/directory')) instanceof CandidateError);
  check('github.com with no repo throws',
    throws(() => detectCandidate('https://github.com/someone')) instanceof CandidateError);
  check('a non-http scheme throws',
    throws(() => detectCandidate('ftp://example.test/x')) instanceof CandidateError);
  check('the error says how to fix it',
    /--type/.test(throws(() => detectCandidate('deepwiki')).message));
}

describe('candidate: --type overrides');
{
  check('--type forces the answer',
    t('https://github.com/owner/repo', { type: 'mcp-server' }) === 'mcp-server');
  check('a forced candidate is marked forced',
    detectCandidate('https://github.com/owner/repo', { type: 'mcp-server' }).forced === true);
  check('detection is marked not-forced', detectCandidate('https://x.test/mcp').forced === false);
  check('an unknown --type throws',
    throws(() => detectCandidate('https://x.test', { type: 'plugin' })) instanceof CandidateError);
}

describe('candidate: only an mcp server can cost money');
{
  // The rule that keeps a skill out of the paid path. If this inverts, /vet
  // will pay to grade a markdown file and the report will claim a behavioural
  // grade that cannot exist.
  check('mcp-server may be graded', mayBeGraded('mcp-server') === true);
  check('a skill may NOT be graded', mayBeGraded('skill') === false);
  check('a repo may NOT be graded', mayBeGraded('repo') === false);
  check('an unknown type may NOT be graded', mayBeGraded('anything-else') === false);
  check('exactly one of the three types is gradeable',
    CANDIDATE_TYPES.filter(mayBeGraded).length === 1,
    CANDIDATE_TYPES.filter(mayBeGraded).join(','));
}

describe('candidate: note filenames');
{
  check('a url slug keeps the FULL hostname',
    candidateSlug({ id: 'https://mcp.deepwiki.com/mcp' }) === 'mcp-deepwiki-com-mcp',
    candidateSlug({ id: 'https://mcp.deepwiki.com/mcp' }));

  // The poller's collision bug, in filename form: two vendors published at
  // mcp.<vendor>.com must not share one note and overwrite each other.
  const a = candidateSlug({ id: 'https://mcp.deepwiki.com/mcp' });
  const b = candidateSlug({ id: 'https://mcp.attacker.example/mcp' });
  check('two mcp.<vendor> hosts do not collide', a !== b, `${a} vs ${b}`);

  check('a local path keeps the filename',
    candidateSlug({ id: './notes/my-skill.md' }) === 'my-skill',
    candidateSlug({ id: './notes/my-skill.md' }));
  check('a slug is filesystem safe',
    /^[a-z0-9-]+$/.test(candidateSlug({ id: 'https://Ex.test/a b/c?d=1' })),
    candidateSlug({ id: 'https://Ex.test/a b/c?d=1' }));
  check('an unsluggable id still yields something', candidateSlug({ id: '///' }) === 'candidate');
}
