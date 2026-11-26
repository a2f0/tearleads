import type { ApiRequestMetricsSnapshot } from "@tearleads/client-sdk";

const POLL_MS = 25;

interface RequestTotals {
  readonly total: number;
  readonly inFlight: number;
  readonly endpoints: ApiRequestMetricsSnapshot["endpoints"];
}

/**
 * Requests under each identity scope the SDK counted them under. The SDK
 * counts a request under its signing fingerprint, or null before it has
 * one; a scope named twice counts once.
 */
export function requestTotals(
  getSnapshot: (scope: string | null) => ApiRequestMetricsSnapshot,
  scopes: readonly (string | null)[],
): RequestTotals {
  const snapshots = [...new Set(scopes)].map(getSnapshot);
  return {
    total: snapshots.reduce((sum, snapshot) => sum + snapshot.total, 0),
    inFlight: snapshots.reduce((sum, snapshot) => sum + snapshot.inFlight, 0),
    endpoints: snapshots.flatMap((snapshot) => snapshot.endpoints),
  };
}

interface SettleClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: SettleClock = {
  now: () => performance.now(),
  sleep: (ms) => Bun.sleep(ms),
};

/**
 * Waits until `idle` resolves and no request has started, run or finished
 * for `quietMs`, polling every 25 ms, and returns when the probe last saw one,
 * measured from `started`. Some catch-up work re-arms itself on timers the
 * sync coordinator does not track, so idle alone does not show that a reload
 * has finished.
 */
export async function settle(input: {
  readonly started: number;
  readonly quietMs: number;
  readonly timeoutMs: number;
  readonly idle: () => Promise<void>;
  readonly totals: () => Pick<RequestTotals, "total" | "inFlight">;
  readonly clock?: SettleClock | undefined;
}): Promise<number> {
  const clock = input.clock ?? systemClock;
  let seen = input.totals();
  // Requests begun before the first poll happened at some point up to now.
  let lastActivity =
    seen.total > 0 || seen.inFlight > 0 ? clock.now() : input.started;
  for (;;) {
    await input.idle();
    await clock.sleep(POLL_MS);
    const now = clock.now();
    if (now - input.started > input.timeoutMs)
      throw new Error("The reload did not settle.");
    const current = input.totals();
    if (
      current.total !== seen.total ||
      current.inFlight > 0 ||
      seen.inFlight > 0
    )
      lastActivity = now;
    seen = current;
    if (now - lastActivity >= input.quietMs)
      return lastActivity - input.started;
  }
}
