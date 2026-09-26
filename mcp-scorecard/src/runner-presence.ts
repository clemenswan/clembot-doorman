/**
 * Whether anything is listening, said out loud.
 *
 * The probe runner is a process on a laptop. When it is not running, `POST
 * /grade` still answers `202` with a poll url, and the audit sits in `pending`
 * forever. The 2026-09-19 launch audit found the last `claimed` event was six
 * days old while the endpoint went on accepting work, which is invariant 9
 * pointed at availability: the service was not fabricating a grade, it was
 * fabricating the expectation of one.
 *
 * This does NOT refuse the queue. Queuing while nobody is listening is a
 * legitimate state, and a queue that empties later is the normal case for an
 * offline worker. What is not legitimate is saying `queued` and nothing else,
 * because the caller reasonably reads that as "and it will be graded".
 *
 * ── Why the heartbeat is the POLL, not the CLAIM ───────────────────────────
 *
 * The obvious signal is the newest `claimed` row in the ledger. It is wrong:
 * a runner polling an EMPTY queue claims nothing and writes no ledger row, so
 * a healthy runner on a quiet day is indistinguishable from no runner at all.
 * That false negative would put "nobody is listening" in front of users at
 * exactly the moment the service was working. The poll itself is the evidence
 * that something is there, so the poll is what gets recorded.
 */

/** Older than this and the runner is reported as not listening. */
export const RUNNER_STALE_AFTER_MS = 5 * 60_000;

/**
 * A write per poll would be ~17k D1 writes a day at a 5 second interval, on a
 * service whose other new control exists to protect that same quota. One a
 * minute is enough to answer "is anything there" inside a 5 minute window.
 */
export const HEARTBEAT_MIN_INTERVAL_MS = 60_000;

export interface RunnerPresence {
  /** False when nothing has polled recently, null when it cannot be determined. */
  online: boolean | null;
  last_seen: string | null;
  runner: string | null;
  /** Plain sentence for a caller. Null when a runner is listening. */
  note: string | null;
}

/**
 * Record that a runner asked for work. Throttled, and never fatal.
 *
 * A failure here must not break the poll: the heartbeat is diagnostic, and a
 * runner that cannot write it is still a runner doing its job. This is the one
 * place in this file where failing OPEN is right, and it is the opposite
 * choice from the rate limiter deliberately: that one guards a resource, this
 * one only describes the world.
 */
export async function recordRunnerSeen(
  env: { DB: D1Database }, runner: string, now = Date.now(),
): Promise<void> {
  const iso = new Date(now).toISOString();
  try {
    const row = await env.DB.prepare(
      'SELECT last_seen FROM runner_seen WHERE runner = ?',
    ).bind(runner).first<{ last_seen: string }>();

    if (row && now - Date.parse(row.last_seen) < HEARTBEAT_MIN_INTERVAL_MS) return;

    await env.DB.prepare(
      'INSERT INTO runner_seen (runner, last_seen) VALUES (?, ?) ' +
      'ON CONFLICT(runner) DO UPDATE SET last_seen = excluded.last_seen',
    ).bind(runner, iso).run();
  } catch {
    // Diagnostic only. See the note above.
  }
}

/**
 * Is anything listening?
 *
 * `online: null` when the question could not be answered, never `false`. An
 * unreadable table means unknown, and reporting unknown as "offline" would put
 * a false alarm in front of every caller. Invariant 3, applied to a status.
 */
export async function runnerPresence(
  env: { DB: D1Database }, now = Date.now(),
): Promise<RunnerPresence> {
  try {
    const row = await env.DB.prepare(
      'SELECT runner, last_seen FROM runner_seen ORDER BY last_seen DESC LIMIT 1',
    ).first<{ runner: string; last_seen: string }>();

    if (!row) {
      return {
        online: false, last_seen: null, runner: null,
        note: 'No probe runner has ever polled this deployment, so a queued audit ' +
          'will wait until one connects. Nothing is lost while it waits.',
      };
    }

    const ageMs = now - Date.parse(row.last_seen);
    if (!Number.isFinite(ageMs)) {
      return { online: null, last_seen: row.last_seen, runner: row.runner, note: null };
    }
    if (ageMs <= RUNNER_STALE_AFTER_MS) {
      return { online: true, last_seen: row.last_seen, runner: row.runner, note: null };
    }
    return {
      online: false, last_seen: row.last_seen, runner: row.runner,
      note: `No probe runner has polled since ${row.last_seen}, so a queued audit ` +
        'will wait until one connects. Nothing is lost while it waits.',
    };
  } catch {
    return { online: null, last_seen: null, runner: null, note: null };
  }
}
