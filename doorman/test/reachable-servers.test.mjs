/**
 * Servers an agent can reach that a project's own files never mention.
 *
 * `doorman doctor` on ClemVault reported "no MCP servers declared" while the
 * session had seven claude.ai connectors and four synced plugins carrying
 * twenty-odd remote servers. Every one of those is a tool description an agent
 * reads as instructions, and the one command whose job is listing them saw none.
 *
 * The fixture is a fake HOME on disk, built per test, because the shapes that
 * break here are file shapes: a plugin installed for a different project, an
 * `.mcp.json` entry with an empty url, a user-scope and project-scope copy of
 * the same plugin.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, describe } from './harness.mjs';
import { toolPrefix, userScopeServers } from '../src/reachable-servers.mjs';

function write(file, obj) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(obj));
}

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'reach-home-'));
  const root = mkdtempSync(join(tmpdir(), 'reach-proj-'));
  const other = join(tmpdir(), 'some-other-project');

  write(join(home, '.claude.json'), {
    mcpServers: { userwide: { type: 'http', url: 'https://user.example/mcp' } },
    projects: {
      [root.replace(/\\/g, '/')]: { mcpServers: { localonly: { command: 'node', args: ['s.js'] } } },
      [other]: { mcpServers: { notmine: { type: 'http', url: 'https://nope.example/mcp' } } },
    },
    claudeAiMcpEverConnected: ['claude.ai Google Calendar', 'claude.ai Notion'],
  });

  const pluginDir = join(home, 'plugin-cache', 'toolkit');
  write(join(pluginDir, '.mcp.json'), { mcpServers: { search: { type: 'http', url: 'https://search.example/mcp' } } });
  const foreignDir = join(home, 'plugin-cache', 'foreign');
  write(join(foreignDir, '.mcp.json'), { mcpServers: { secret: { type: 'http', url: 'https://foreign.example/mcp' } } });
  const offDir = join(home, 'plugin-cache', 'off');
  write(join(offDir, '.mcp.json'), { mcpServers: { dark: { type: 'http', url: 'https://off.example/mcp' } } });

  write(join(home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'toolkit@market': [
        { scope: 'user', installPath: pluginDir },
        { scope: 'project', projectPath: root, installPath: pluginDir },
      ],
      'foreign@market': [{ scope: 'project', projectPath: other, installPath: foreignDir }],
      'off@market': [{ scope: 'user', installPath: offDir }],
    },
  });
  write(join(home, '.claude', 'settings.json'), { enabledPlugins: { 'off@market': false } });

  write(join(home, '.claude', 'plugins', 'synced', 'acct_1', 'marketing', '.mcp.json'), {
    mcpServers: {
      canva: { type: 'http', url: 'https://mcp.canva.com/mcp' },
      'google calendar': { type: 'http', url: '' },
    },
  });
  return { home, root };
}

describe('reachable-servers: tool prefix matches what the gate sees');
check('claude.ai connector', toolPrefix('claude.ai Google Calendar') === 'claude_ai_Google_Calendar');
check('plugin keeps hyphens', toolPrefix('plugin_product-management_amplitude-eu') === 'plugin_product-management_amplitude-eu');
check('plain project server unchanged', toolPrefix('scorecard') === 'scorecard');

describe('reachable-servers: what lives outside the project');
{
  const { home, root } = fakeHome();
  const servers = userScopeServers(root, { home });
  const by = (g) => servers.find((s) => s.gateName === g);
  const names = servers.map((s) => s.gateName).sort();

  check('user-scope ~/.claude.json server found', by('userwide')?.target === 'https://user.example/mcp');
  check('local-scope server for THIS project found', by('localonly')?.transport === 'stdio');
  check('another project\'s local server is not reachable here', !by('notmine'));
  check('claude.ai connectors found, keyed as the gate sees them',
    by('claude_ai_Notion')?.transport === 'claude.ai' && Boolean(by('claude_ai_Google_Calendar')));
  check('a connector has no local url, and says so rather than inventing one',
    by('claude_ai_Notion')?.target === null && /not stored locally/.test(by('claude_ai_Notion')?.note || ''));
  check('installed plugin server is prefixed plugin_<plugin>_<server>',
    by('plugin_toolkit_search')?.target === 'https://search.example/mcp');
  check('user and project installs of one plugin list it once',
    servers.filter((s) => s.gateName === 'plugin_toolkit_search').length === 1);
  check('a plugin installed for a different project is not reachable here', !by('plugin_foreign_secret'));
  check('a plugin disabled in settings is not reachable', !by('plugin_off_dark'));
  check('synced plugin server found', by('plugin_marketing_canva')?.target === 'https://mcp.canva.com/mcp');
  check('an entry with an empty url never loads, so it is not listed', !by('plugin_marketing_google_calendar'));
  check('exactly the reachable set, nothing extra', names.length === 6, names.join(', '));
}

describe('reachable-servers: no home means nothing, not a crash');
check('missing home returns []', userScopeServers('/x', {}).length === 0);
check('empty home dir returns []', userScopeServers('/x', { home: mkdtempSync(join(tmpdir(), 'reach-empty-')) }).length === 0);
