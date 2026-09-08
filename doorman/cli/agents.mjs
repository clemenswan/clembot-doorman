/**
 * Agent adapters — doorman drives YOUR harness, not one of its own.
 *
 * The first version of this shipped its own agent loop calling Anthropic
 * directly. That measures a toy agent, and the answer it produces is about the
 * toy. "Does this tool help?" has no universal answer: it depends on which
 * harness you run, which model, and what your agents actually do. So the arms
 * run whatever agent you already use, with your key, on your machine.
 *
 * Consequences worth being explicit about:
 *
 *   - **Nothing runs on anyone else's infrastructure.** The adopter's key stays
 *     in the adopter's environment. It is passed into a local container and is
 *     never written to a file, never logged, and never leaves the machine
 *     except to the model provider the adopter already uses.
 *   - **The report is about their build.** A central benchmark answers the
 *     benchmarker's question. This answers theirs.
 *   - **Metrics differ by adapter, and the report says which.** A harness that
 *     reports token usage gets a token comparison; one that does not gets wall
 *     time and success rate, and the missing columns are shown as `n/a` rather
 *     than filled with a plausible estimate.
 */

/**
 * `capabilities` is the honest part. It declares what the adapter can actually
 * measure, so the report can show `n/a` instead of inventing a number.
 */
export const ADAPTERS = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code (headless)',
    install: 'npm install -g @anthropic-ai/claude-code',
    /** Env the adopter must already have. Passed through, never stored. */
    passEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
    capabilities: { success: true, wall: true, turns: true, tokens: true, cost: true },
    /** Reads one JSON result object; Claude Code reports its own usage. */
    command: (promptFile) =>
      `cat ${promptFile} | claude -p --output-format json --permission-mode bypassPermissions`,
    parse(stdout) {
      const line = stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
      if (!line) return { parsed: false };
      try {
        const j = JSON.parse(line);
        return {
          parsed: true,
          turns: j.num_turns ?? null,
          cost_usd: j.total_cost_usd ?? null,
          tokens: (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0) || null,
          tool_calls: null,   // not reported by this output format
        };
      } catch { return { parsed: false }; }
    },
  },

  builtin: {
    id: 'builtin',
    label: 'doorman built-in loop (Anthropic API)',
    install: null,                       // already in the base image
    passEnv: ['ANTHROPIC_API_KEY'],
    capabilities: { success: true, wall: true, turns: true, tokens: true, cost: true },
    command: () => 'node /opt/harness.mjs',
    parse(stdout) {
      const line = stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
      if (!line) return { parsed: false };
      try { return { parsed: true, ...JSON.parse(line) }; } catch { return { parsed: false }; }
    },
  },

  exec: {
    id: 'exec',
    label: 'any command you name',
    install: null,
    passEnv: [],                         // caller adds their own with --pass-env
    /**
     * Deliberately narrow. A command doorman knows nothing about cannot be
     * asked how many turns it took, so those columns stay empty rather than
     * being guessed from wall time.
     */
    capabilities: { success: true, wall: true, turns: false, tokens: false, cost: false },
    command: (promptFile, { execCommand }) => `cat ${promptFile} | ${execCommand}`,
    parse() { return { parsed: true, turns: null, tokens: null, cost_usd: null, tool_calls: null }; },
  },
};

export function resolveAdapter(name = 'claude-code', opts = {}) {
  const a = ADAPTERS[name];
  if (!a) {
    return {
      ok: false,
      why:
        `unknown agent adapter "${name}". Available: ${Object.keys(ADAPTERS).join(', ')}.\n` +
        'Use --agent exec --exec "<your command>" to drive a harness doorman does ' +
        'not know about; it will measure success and wall time and report the rest ' +
        'as not measured.',
    };
  }
  if (a.id === 'exec' && !opts.execCommand) {
    return { ok: false, why: '--agent exec needs --exec "<command>" to run.' };
  }
  return { ok: true, adapter: a };
}

/**
 * Which of the adapter's env names are actually present.
 *
 * An adapter with none of its credentials present cannot run, and saying so
 * before building an image is cheaper than finding out inside a container.
 */
export function credentialCheck(adapter, env = process.env) {
  if (!adapter.passEnv.length) return { ok: true, using: [], note: 'this adapter needs no credential from doorman' };
  const present = adapter.passEnv.filter((k) => env[k]);
  if (!present.length) {
    return {
      ok: false,
      using: [],
      why:
        `${adapter.label} needs one of ${adapter.passEnv.join(' or ')} in your environment.\n` +
        'doorman passes it straight into the local container and never stores, logs ' +
        'or transmits it. The spend is yours, on your account, at your provider.',
    };
  }
  return { ok: true, using: present };
}

/** Columns this adapter genuinely measured. The report shows the rest as n/a. */
export function unmeasured(adapter) {
  return Object.entries(adapter.capabilities).filter(([, v]) => !v).map(([k]) => k);
}
