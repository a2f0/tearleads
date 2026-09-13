import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import type { WsConnection } from "./wsConnection";

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
   * successful verification, before failing passes evict them all. Defaults
   * to three intervals; 0 disables.
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
  return {
    maxProofAgeMs:
      options.maxProofAgeMs ??
      (options.intervalMs ?? DEFAULT_REVALIDATION_INTERVAL_MS) *
        DEFAULT_MAX_PROOF_AGE_INTERVALS,
    now: options.now ?? Date.now,
    schedule: options.schedule ?? scheduleUnrefTimeout,
  };
}

/**
 * Per-socket timer that re-runs signed access verification over every
 * installed subscription. Eviction is otherwise driven by at-most-once pub/sub
 * (`access_changed`), so a dropped or missed invalidation would leave a revoked
 * subscription live for the socket's lifetime; the periodic pass bounds that
 * window to one interval. Ticks are jittered across [½, 1] of the interval so
 * sockets that connected together do not re-verify together, and re-arm on
 * that cadence rather than on completion. Ticks only attempt verification;
 * the proof-age bound itself is a separate per-socket deadline timer the
 * authorizer arms at `verifiedAt + maxProofAgeMs`.
 */
export class ContainerInterestRevalidationSchedule {
  private readonly timers = new Map<WsConnection, () => void>();
  private readonly intervalMs: number;
  private readonly random: () => number;
  private readonly scheduleTimer: ScheduleTimer;

  constructor(
    private readonly revalidate: (ws: WsConnection) => Promise<void>,
    options: RevalidationScheduleOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_REVALIDATION_INTERVAL_MS;
    this.random = options.random ?? Math.random;
    this.scheduleTimer = options.schedule ?? scheduleUnrefTimeout;
  }

  open(ws: WsConnection): void {
    this.close(ws);
    this.schedule(ws);
  }

  close(ws: WsConnection): void {
    this.timers.get(ws)?.();
    this.timers.delete(ws);
  }

  stop(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
  }

  private schedule(ws: WsConnection): void {
    if (this.intervalMs <= 0) return;
    const delay = Math.round(this.intervalMs * (0.5 + 0.5 * this.random()));
    const cancel = this.scheduleTimer(() => {
      // Only a still-tracked socket re-arms.
      if (this.timers.get(ws) !== cancel) return;
      this.timers.delete(ws);
      this.schedule(ws);
      void this.revalidate(ws).catch((error: unknown) => {
        reportBackgroundFailure(error);
      });
    }, delay);
    this.timers.set(ws, cancel);
  }
}
