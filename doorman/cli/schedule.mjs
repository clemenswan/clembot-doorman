/**
 * `doorman schedule` — Configure automated, recurring tool audits & recommendation reports.
 *
 * Supports three automation modes:
 *   1. Built-in SessionStart Hook (runs silently in background on session open)
 *   2. GitHub Actions Workflow (--github: creates .github/workflows/doorman-audit.yml)
 *   3. Agent / Cron Scheduling (prints crontab entry & /schedule agent prompt)
 */

import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

export const GITHUB_WORKFLOW_YAML = `name: Doorman Tool Audit & Security Report

on:
  schedule:
    # Run every Monday at 09:00 UTC
    - cron: '0 9 * * 1'
  workflow_dispatch:

jobs:
  audit:
    name: Run Clembot Doorman Audit
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Clembot Doorman
        run: npm i -g clembot-doorman

      - name: Run Unified Audit
        run: |
          mkdir -p .doorman
          doorman audit --out .doorman/audit-report.md

      - name: Upload Audit Artifact
        uses: actions/upload-artifact@v4
        with:
          name: doorman-audit-report
          path: .doorman/audit-report.md
`;

export async function schedule(targetDir = process.cwd(), opts = {}) {
  const absRoot = resolve(targetDir);

  if (opts.github) {
    const wfDir = join(absRoot, '.github', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    const wfPath = join(wfDir, 'doorman-audit.yml');
    writeFileSync(wfPath, GITHUB_WORKFLOW_YAML, 'utf8');
    return {
      ok: true,
      mode: 'github',
      path: wfPath,
    };
  }

  // Check hook status
  const sessionHook = join(absRoot, '.claude', 'hooks', 'session-notify.sh');
  const hasHook = existsSync(sessionHook);

  return {
    ok: true,
    mode: 'guide',
    root: absRoot,
    hasHook,
  };
}

export function renderSchedule(res) {
  const lines = [];
  lines.push('');
  lines.push('================================================================');
  lines.push('          CLEMBOT DOORMAN · AUTOMATED AUDIT SCHEDULING           ');
  lines.push('================================================================');
  lines.push('');

  if (res.mode === 'github') {
    lines.push(`  ✓ Created GitHub Actions workflow at:`);
    lines.push(`    ${res.path}`);
    lines.push('');
    lines.push('  This workflow runs `doorman audit` every Monday at 09:00 UTC');
    lines.push('  and uploads the markdown report as an artifact.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('Choose how you want to schedule your tool audit & recommendations:');
  lines.push('');

  // 1. SessionStart Hook
  lines.push('── 1. BUILT-IN SESSION HOOK (ZERO CONFIG) ───────────────────────');
  if (res.hasHook) {
    lines.push('  [ACTIVE] .claude/hooks/session-notify.sh is installed.');
    lines.push('  Claude Code automatically checks for new graded MCP tools at the');
    lines.push('  start of every session and notifies you if fresh tools are available.');
  } else {
    lines.push('  Install the plugin to enable silent background session checks:');
    lines.push('  claude plugin marketplace add clemenswan/clembot-doorman && claude plugin install clembot-doorman');
  }
  lines.push('');

  // 2. AI Agent Loop / Slash Command
  lines.push('── 2. AI AGENT RECURRING SCHEDULING ────────────────────────────');
  lines.push('  In Antigravity or pair-programming chat, invoke the /schedule command:');
  lines.push('  /schedule CronExpression="0 9 * * 1", Prompt="Run doorman audit and report recommended MCP tools"');
  lines.push('');

  // 3. GitHub Actions
  lines.push('── 3. CI/CD GITHUB ACTIONS (RECOMMENDED FOR TEAMS) ──────────────');
  lines.push('  Generate a weekly automated audit workflow with:');
  lines.push('  doorman schedule --github');
  lines.push('');

  // 4. System Cron
  lines.push('── 4. SYSTEM CRON / TASK SCHEDULER ─────────────────────────────');
  lines.push('  Add to your crontab (crontab -e) to generate weekly markdown reports:');
  lines.push(`  0 9 * * 1 cd "${res.root}" && npx clembot-doorman audit --out .doorman/audit.md`);
  lines.push('');

  return lines.join('\n');
}
