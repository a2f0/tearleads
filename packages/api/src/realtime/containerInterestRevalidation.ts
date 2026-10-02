import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";

const DEFAULT_REVALIDATION_INTERVAL_MS = 5 * 60_000;
/** Failing passes may keep unconfirmed proofs for this many intervals. */
const DEFAULT_MAX_PROOF_AGE_INTERVALS = 3;

/** Arms one timer and returns its cancel; injectable for deterministic tests. */
export type ScheduleTimer = (
  callback: () => void,
  delayMs: number,
) => () => void;

function scheduleUnrefTimeout(callback: () => void, delayMs: number) {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}

export interface RevalidationScheduleOptions {
  /** Base period between re-verifications of one socket; 0 disables. */
  readonly intervalMs?: number | undefined;
  /** Jitter source in [0, 1); injectable for deterministic tests. */
  readonly random?: (() => number) | undefined;
  /**
   * Oldest a socket's installed proofs may grow, measured from their last
   * successful verification, before failing passes evict them all. A session
   * left unconfirmed by the session store for as long closes its sockets.
   * Defaults to three intervals; 0 disables both.
   */
  readonly maxProofAgeMs?: number | undefined;
  /** Clock for proof age; injectable for deterministic tests. */
  readonly now?: (() => number) | undefined;
  /** Timer source for ticks and proof deadlines; defaults to unref'd timeouts. */
  readonly schedule?: ScheduleTimer | undefined;
}

export interface ProofAgePolicy {
  readonly maxProofAgeMs: number;
  readonly now: () => number;
  readonly schedule: ScheduleTimer;
}

export function resolveProofAgePolicy(
  options: RevalidationScheduleOptions = {},
): ProofAgePolicy {
  const intervalMs = options.intervalMs ?? DEFAULT_REVALIDATION_INTERVAL_MS;
  const maxProofAgeMs =
    options.maxProofAgeMs ?? intervalMs * DEFAULT_MAX_PROOF_AGE_INTERVALS;
  // A tick can come a whole interval after the last one, and a confirmation
  // dates from when its read started. A bound under two intervals leaves no
  // headroom for that read, so it would evict healthy proofs and close live
  // sessions.
  if (intervalMs > 0 && maxProofAgeMs > 0 && maxProofAgeMs < 2 * intervalMs) {
    throw new Error(
      "maxProofAgeMs must be at least twice the revalidation interval",
    );
  }
  return {
    maxProofAgeMs,
    now: options.now ?? Date.now,
    schedule: options.schedule ?? scheduleUnrefTimeout,
  };
}

/**
 * Per-key jittered timer: one per socket to re-run signed access verification
 * over every installed subscription, and one per session to recheck that it is
 * still live. Eviction is otherwise driven by at-most-once pub/sub
 * (`access_changed`, `session_revoked`), so a dropped or missed invalidation
 * would leave a revoked subscription or session live for the socket's lifetime;
 * the periodic pass bounds that window to one interval. Ticks are jittered
 * across [½, 1] of the interval so keys opened together do not re-verify
 * together, and re-arm on that cadence rather than on completion. Ticks only
 * attempt verification; the age bound itself is a separate deadline timer
 * armed at the last confirmation plus `maxProofAgeMs`.
 */
export class RevalidationSchedule<Key> {
  private readonly timers = new Map<Key, () => void>();
  private readonly intervalMs: number;
  private readonly random: () => number;
  private readonly scheduleTimer: ScheduleTimer;

  constructor(
    private readonly revalidate: (key: Key) => Promise<void>,
    options: RevalidationScheduleOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_REVALIDATION_INTERVAL_MS;
    this.random = options.random ?? Math.random;
    this.scheduleTimer = options.schedule ?? scheduleUnrefTimeout;
  }

  /** Whether ticks run at all; an interval of 0 disables them. */
  get enabled(): boolean {
    return this.intervalMs > 0;
  }

  open(key: Key): void {
    this.close(key);
    this.schedule(key);
  }

  close(key: Key): void {
    this.timers.get(key)?.();
    this.timers.delete(key);
  }

  stop(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
  }

  private schedule(key: Key): void {
    if (this.intervalMs <= 0) return;
    const delay = Math.round(this.intervalMs * (0.5 + 0.5 * this.random()));
    const cancel = this.scheduleTimer(() => {
      // Only a still-tracked key re-arms.
      if (this.timers.get(key) !== cancel) return;
      this.timers.delete(key);
      this.schedule(key);
      void this.revalidate(key).catch((error: unknown) => {
        reportBackgroundFailure(error, "websocket.revalidate");
      });
    }, delay);
    this.timers.set(key, cancel);
  }
}
