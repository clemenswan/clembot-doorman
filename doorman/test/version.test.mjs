/**
 * One version, declared in four places, pinned here.
 *
 * The 0.2.0 tarball was built, extracted, and run on 2026-09-12. It printed
 * `0.1.0`, because cli/doorman.mjs carries its own hardcoded constant and
 * nothing tied it to the package. A user checking `doorman --version` to see
 * whether they have the push half would have been told the wrong thing by the
 * exact command the README gives them for that purpose.
 *
 * Reading package.json at runtime was the other option. A test was chosen over
 * a file read on every CLI start: the drift is what needs catching, and it
 * needs catching before a publish, not during one.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, describe } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, '..');

describe('the version is declared once, in four files');

const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
const nested = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const plugin = JSON.parse(
  readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
).version;
const cli = /const VERSION = '([^']+)'/.exec(
  readFileSync(join(ROOT, 'cli', 'doorman.mjs'), 'utf8'),
);

check('the published package declares one', Boolean(pkg), 'root package.json has no version');
check('the CLI declares one', Boolean(cli), "cli/doorman.mjs has no `const VERSION = '...'`");
check('doorman/package.json agrees with the published package',
  nested === pkg, `${nested} vs ${pkg}`);
check('the plugin manifest agrees, which is what Claude Code displays',
  plugin === pkg, `${plugin} vs ${pkg}`);
check('`doorman --version` agrees, which is what a user is told to check',
  cli && cli[1] === pkg, `${cli && cli[1]} vs ${pkg}`);
