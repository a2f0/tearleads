import type { Frame } from "../hubSocket";

/** How long hints for another socket waited while the hub was busy. */
export interface HintLag {
  readonly intervalMs: number;
  readonly sent: number;
  readonly delivered: number;
  /** Delivery time minus the time the hint was due to be published. */
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Total lag above one interval: time hints spent waiting on the hub. */
  readonly blockedMs: number;
}

interface HintObserver {
  readonly listen: (listener: (frame: Frame) => void) => () => void;
}

export interface MonitorClock<Timer> {
  readonly now: () => number;
  readonly setTimeout: (run: () => void, delayMs: number) => Timer;
  readonly clearTimeout: (timer: Timer) => void;
}

export const systemClock: MonitorClock<ReturnType<typeof setTimeout>> = {
  now: () => performance.now(),
  setTimeout: (run, delayMs) => setTimeout(run, delayMs),
  clearTimeout: (timer) => {
    clearTimeout(timer);
  },
};

const round = (value: number) => Math.round(value * 10) / 10;

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(fraction * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)] ?? 0;
}

export function summarizeLags(
  lags: readonly number[],
  sent: number,
  intervalMs: number,
): HintLag {
  const sorted = [...lags].sort((a, b) => a - b);
  return {
    intervalMs,
    sent,
    delivered: sorted.length,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
    blockedMs: round(
      sorted.reduce((total, lag) => total + Math.max(0, lag - intervalMs), 0),
    ),
  };
}

/**
 * Publishes a `document_update_created` hint for `containerId` every
 * `intervalMs` through the hub, and times each one until the observer
 * socket receives it. A hint stands in for any event that arrives while the
 * hub is busy: its timer cannot fire, nor its routing run, until the hub's
 * thread is free. Deadlines missed during a stall are skipped, so one stall
 * delays one hint rather than releasing a burst.
 */
export function startHintMonitor<Timer>(
  input: {
    readonly intervalMs: number;
    readonly containerId: string;
    readonly observer: HintObserver;
    readonly publish: (message: string) => Promise<void>;
  },
  clock: MonitorClock<Timer>,
) {
  const due = new Map<string, number>();
  const lags: number[] = [];
  const failures: unknown[] = [];
  let sent = 0;
  let stopped = false;
  const stopListening = input.observer.listen((frame) => {
    if (frame.type !== "document_update_created") return;
    if (typeof frame.documentId !== "string") return;
    const dueAt = due.get(frame.documentId);
    if (dueAt === undefined) return;
    due.delete(frame.documentId);
    // Timers round their delay, so a hint can fire a fraction of a
    // millisecond before it was due; that is no wait at all.
    lags.push(Math.max(0, clock.now() - dueAt));
  });
  let next = clock.now() + input.intervalMs;
  const tick = () => {
    if (stopped) return;
    const documentId = crypto.randomUUID();
    due.set(documentId, next);
    sent++;
    input
      .publish(
        JSON.stringify({
          type: "document_update_created",
          containerIds: [input.containerId],
          documentId,
        }),
      )
      .catch((error: unknown) => {
        failures.push(error);
      });
    next += input.intervalMs;
    const now = clock.now();
    while (next <= now) next += input.intervalMs;
    timer = clock.setTimeout(tick, next - now);
  };
  let timer = clock.setTimeout(tick, input.intervalMs);
  return {
    stop(): HintLag {
      stopped = true;
      clock.clearTimeout(timer);
      stopListening();
      if (failures.length > 0)
        throw new Error(`${failures.length} hints failed to publish.`);
      return summarizeLags(lags, sent, input.intervalMs);
    },
  };
}
