/**
 * `doorman audit` — Unified security audit & tool recommendation report.
 *
 * Combines three layers in one fast, local sweep:
 *   1. L0 doctor: Inspects your harness, gate wiring, and installed MCP servers.
 *   2. L0.5 needs: Scans local prompt history to detect missing capability needs.
 *   3. L2 watch: Cross-references unmet gaps against the public graded feed.
 *
 * Output: An actionable, executive-grade posture and tool recommendation report.
 * Free, offline-first, zero runtime dependencies.
 */

import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { doctor } from './doctor.mjs';
import { needs as readNeeds } from './needs.mjs';
import { watch } from './watch.mjs';

export async function auditProject(targetDir = process.cwd(), opts = {}) {
  const absRoot = resolve(targetDir);

  // 1. Run Doctor (L0: Harness, Gate, Installed servers)
  const doc = await doctor(absRoot, opts);
  if (!doc.ok) {
    return { ok: false, why: doc.why };
  }

  // 2. Run Needs (L0.5: Prompt history scan for capability gaps)
  let needsResult = null;
  try {
    needsResult = await readNeeds({
      root: absRoot,
      historyDir: opts.historyDir,
      candidateFile: opts.candidateFile,
      api: opts.api,
    });
  } catch {
    needsResult = null;
  }

  // 3. Run Watch (L2: Classified feed of newly graded tools & threats)
  let watchResult = null;
  try {
    watchResult = await watch({
      root: absRoot,
      api: opts.api,
      all: true,
    });
  } catch {
    watchResult = null;
  }

  // Synthesize executive findings
  const gateStatus = doc.gate?.verdict || 'unknown';
  const isGateWired = gateStatus === 'installed and wired' || gateStatus.includes('wired');
  const harnesses = (doc.harnesses || []).map((h) => h.harness);
  const installedCount = (doc.servers || []).length;

  const gaps = (needsResult?.matches || []).filter((m) => m.status === 'GAP' || m.status === 'UNMET');
  const covered = (needsResult?.matches || []).filter((m) => m.status === 'COVERED');

  const candidates = watchResult?.candidates || [];
  const recommended = candidates
    .filter((c) => (c.grade === 'A' || c.grade === 'B') && c.verdict === 'unreviewed' && !c.is_fixture && !c.self_graded)
    .slice(0, 5);

  const blockedThreats = candidates
    .filter((c) => c.grade === 'F' || c.hard_fail || c.verdict === 'blocked')
    .slice(0, 3);

  const result = {
    ok: true,
    root: absRoot,
    timestamp: new Date().toISOString(),
    posture: {
      gateStatus,
      isGateWired,
      harnesses,
      installedCount,
      agentsCount: doc.agents?.count ?? 0,
    },
    needs: {
      totalPrompts: needsResult?.promptCount ?? 0,
      gaps,
      covered,
    },
    recommendations: recommended,
    threats: blockedThreats,
  };

  if (opts.out) {
    const md = renderAuditMarkdown(result);
    writeFileSync(opts.out, md, 'utf8');
    result.outFile = opts.out;
  }

  return result;
}

export function renderAuditMarkdown(res) {
  const lines = [];
  lines.push('# Clembot Doorman Security & Tool Recommendation Report');
  lines.push(`\n**Target:** \`${res.root}\``);
  lines.push(`**Generated:** ${res.timestamp}`);
  lines.push('');

  // Posture
  lines.push('## 1. Security & Gate Posture');
  const gateIcon = res.posture.isGateWired ? 'PASS' : 'WARN';
  lines.push(`- **Gate Status:** [${gateIcon}] ${res.posture.gateStatus}`);
  lines.push(`- **Harnesses Detected:** ${res.posture.harnesses.join(', ') || 'none'}`);
  lines.push(`- **Reachable MCP Servers:** ${res.posture.installedCount}`);
  lines.push(`- **Subagents Configured:** ${res.posture.agentsCount}`);
  lines.push('');

  // Recommendations based on needs
  lines.push('## 2. Capability Needs & Tool Recommendations');
  if (res.needs.gaps.length > 0) {
    lines.push('Your prompt history reveals the following unmet tool capabilities:');
    for (const g of res.needs.gaps) {
      lines.push(`- **${g.title}:** ${g.promptsCount} prompt(s) reaching for this capability.`);
      if (g.topCandidates && g.topCandidates.length > 0) {
        for (const c of g.topCandidates.slice(0, 2)) {
          lines.push(`  → Recommended: **${c.name || c.url}** (${c.grade ? `Grade ${c.grade}` : 'verified'})`);
        }
      }
    }
  } else {
    lines.push('- No active capability gaps detected in prompt history.');
  }
  lines.push('');

  if (res.recommendations.length > 0) {
    lines.push('### Top Verified Safe MCP Servers');
    for (const r of res.recommendations) {
      const score = typeof r.score === 'number' ? `${r.score.toFixed(1)}/100` : 'passing';
      lines.push(`- **${r.server_name || r.server_url}** — Grade **${r.grade}** (${score})`);
      lines.push(`  \`${r.server_url}\``);
    }
    lines.push('');
  }

  // Threats
  lines.push('## 3. Threat Intelligence');
  if (res.threats.length > 0) {
    lines.push('The following servers failed security inspection and are blocked at the gate:');
    for (const t of res.threats) {
      const reason = t.hard_fail || 'Failed safety scan / commercial steering detected';
      lines.push(`- ⚠️ **${t.server_name || t.server_url}** — Grade **${t.grade}** [BLOCKED]: ${reason}`);
    }
  } else {
    lines.push('- No active threat flags recorded on your trust list.');
  }
  lines.push('');

  // Next Steps
  lines.push('## 4. Recommended Actions');
  if (!res.posture.isGateWired) {
    lines.push('1. **Wire the security gate:** `claude plugin marketplace add clemenswan/clembot-doorman && claude plugin install clembot-doorman`');
  }
  lines.push('2. **Vet new candidate servers before adoption:** `/vet <url>`');
  lines.push('3. **Allow trusted servers:** `doorman allow <server-name>`');
  lines.push('4. **Schedule recurring audits:** `doorman schedule`');

  return lines.join('\n');
}

export function renderAudit(res) {
  const lines = [];
  lines.push('');
  lines.push('================================================================');
  lines.push('          CLEMBOT DOORMAN · UNIFIED AUDIT & RECOMMENDATIONS     ');
  lines.push('================================================================');
  lines.push(`Build: ${res.root}`);
  lines.push('');

  // 1. Security Posture
  lines.push('── 1. SECURITY POSTURE ─────────────────────────────────────────');
  const gateMark = res.posture.isGateWired ? '✓' : '!';
  lines.push(`  [${gateMark}] Gate: ${res.posture.gateStatus}`);
  lines.push(`  [i] Harness: ${res.posture.harnesses.join(', ') || 'None declared'}`);
  lines.push(`  [i] Reachable MCP Tools: ${res.posture.installedCount} declared`);
  lines.push('');

  // 2. Capability Recommendations
  lines.push('── 2. CAPABILITY GAPS & RECOMMENDED TOOLS ──────────────────────');
  if (res.needs.gaps.length > 0) {
    lines.push(`  Detected ${res.needs.gaps.length} capability gap(s) from prompt history:`);
    for (const g of res.needs.gaps) {
      lines.push(`  • ${g.title} (${g.promptsCount} prompt asks)`);
    }
  } else {
    lines.push('  No unmet capability gaps detected.');
  }

  if (res.recommendations.length > 0) {
    lines.push('');
    lines.push('  Top Vetted Candidates from Graded Feed:');
    for (const r of res.recommendations) {
      const score = typeof r.score === 'number' ? `${r.score.toFixed(1)}/100` : '';
      lines.push(`  → [Grade ${r.grade} · ${score}] ${r.server_name || 'Server'}`);
      lines.push(`    URL: ${r.server_url}`);
    }
  }
  lines.push('');

  // 3. Blocked Threats
  lines.push('── 3. THREATS BLOCKED AT THE GATE ──────────────────────────────');
  if (res.threats.length > 0) {
    for (const t of res.threats) {
      lines.push(`  ✗ [Grade ${t.grade}] ${t.server_name || t.server_url}`);
      if (t.hard_fail) lines.push(`    Reason: ${t.hard_fail}`);
    }
  } else {
    lines.push('  No active security alerts on installed servers.');
  }
  lines.push('');

  // 4. Quick Actions
  lines.push('── 4. QUICK ACTIONS ────────────────────────────────────────────');
  if (!res.posture.isGateWired) {
    lines.push('  • Wire Gate:   claude plugin install clembot-doorman');
  }
  lines.push('  • Vet Tool:    /vet <candidate_url>');
  lines.push('  • Trust Tool:  doorman allow <server_name>');
  lines.push('  • Schedule:    doorman schedule');
  if (res.outFile) {
    lines.push(`  • Report:      Saved to ${res.outFile}`);
  }
  lines.push('');
  return lines.join('\n');
}
