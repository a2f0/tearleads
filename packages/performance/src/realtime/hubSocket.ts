import type { InProcessApi } from "./inProcessApi";

type GatewayDeps = NonNullable<
  Parameters<InProcessApi["createRealtimeGateway"]>[0]
>;
type Gateway = ReturnType<InProcessApi["createRealtimeGateway"]>;
type GatewaySocket = Parameters<Gateway["websocket"]["open"]>[0];
type ScheduleTimer = NonNullable<
  NonNullable<GatewayDeps["revalidation"]>["schedule"]
>;
interface ArmedTimer {
  readonly run: Parameters<ScheduleTimer>[0];
  readonly delayMs: number;
}

// The hub's base authorization budget and its cap (`containerInterestQueries.ts`).
const PRODUCTION_BUDGET_MS = 10_000;
const IDS_PER_BUDGET = 100;
const MAX_BUDGETS = 6;
// Far past any run, so only the probe fires the jittered tick. With
// `random` fixed at 0 every tick is armed at half the interval.
const REVALIDATION_INTERVAL_MS = 2 * 60 * 60_000;
const TICK_DELAY_MS = REVALIDATION_INTERVAL_MS / 2;
// A tick is armed at `at - now()`, so the clock can shave a little off its
// delay. Read timeouts (seconds) and proof deadlines (three intervals) are
// far from this window.
const TICK_WINDOW_MS = 60_000;
// Generous, so a slow pass is measured rather than cut off; the report
// compares its duration with the production budget instead.
const PROBE_BUDGET_MS = 10 * 60_000;
// The hibernating hub stores each socket's snapshot in chunks of this many
// characters (`worker/hubSocketStore.ts`).
const SNAPSHOT_CHUNK_CHARS = 16 * 1024;

/** The authorization deadline a declaration of `ids` gets in production. */
export function productionBudgetMs(ids: number): number {
  const budgets = Math.min(
    MAX_BUDGETS,
    Math.max(1, Math.ceil(ids / IDS_PER_BUDGET)),
  );
  return PRODUCTION_BUDGET_MS * budgets;
}

export interface AuthorizationCall {
  readonly ids: number;
  readonly proofs: number;
  readonly durationMs: number;
  readonly failed: boolean;
}

interface Frame {
  readonly type?: unknown;
  readonly declarationId?: unknown;
  readonly containerIds?: unknown;
}

function frameIds(frame: Frame | undefined): number {
  return Array.isArray(frame?.containerIds) ? frame.containerIds.length : 0;
}

/** The hub's own authorization, timed per call. */
function timedAuthorization(
  api: InProcessApi,
  calls: AuthorizationCall[],
): InProcessApi["authorizeContainerAccess"] {
  return async (userId, ids) => {
    const started = performance.now();
    let proofs = 0;
    let failed = true;
    try {
      const result = await api.authorizeContainerAccess(userId, ids);
      proofs = result.length;
      failed = false;
      return result;
    } finally {
      calls.push({
        ids: ids.length,
        proofs,
        durationMs: performance.now() - started,
        failed,
      });
    }
  };
}

/**
 * A gateway whose timers wait in `timers` until the probe runs them. Pub/sub
 * and the session store are stubbed out, so nothing else runs while a pass
 * is measured.
 */
function createProbeGateway(
  api: InProcessApi,
  timers: Set<ArmedTimer>,
  calls: AuthorizationCall[],
): Gateway {
  return api.createRealtimeGateway({
    authorizeContainerAccess: timedAuthorization(api, calls),
    containerAuthorizationTimeoutMs: PROBE_BUDGET_MS / MAX_BUDGETS,
    revalidation: {
      intervalMs: REVALIDATION_INTERVAL_MS,
      random: () => 0,
      schedule: (run, delayMs) => {
        const timer = { run, delayMs };
        timers.add(timer);
        return () => {
          timers.delete(timer);
        };
      },
    },
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
    validateSession: async () => true,
  });
}

/**
 * One socket on a fresh realtime gateway, with the hub's real authorization
 * and routing. The revalidation tick fires only when the probe asks for it.
 */
export function openHubSocket(api: InProcessApi, userId: string) {
  const timers = new Set<ArmedTimer>();
  const frames: Frame[] = [];
  const calls: AuthorizationCall[] = [];
  const gateway = createProbeGateway(api, timers, calls);
  const socket: GatewaySocket = {
    data: { userId, sessionId: crypto.randomUUID() },
    send: (message: string) => {
      // The gateway sends only serialized server messages, all objects.
      const frame: Frame = JSON.parse(message);
      frames.push(frame);
    },
    close: () => undefined,
  };
  gateway.websocket.open(socket);

  /** Authorization calls made by `work`, and the frames it sent. */
  async function observe(work: () => Promise<void>) {
    const firstCall = calls.length;
    const firstFrame = frames.length;
    await work();
    return {
      calls: calls.slice(firstCall),
      frames: frames.slice(firstFrame),
    };
  }

  return {
    /** A full `known_containers` replace, answered by its acknowledgement. */
    async declare(ids: readonly string[]) {
      const declarationId = crypto.randomUUID();
      const message = JSON.stringify({
        type: "known_containers",
        declarationId,
        containerIds: ids,
      });
      const seen = await observe(() =>
        gateway.websocket.message(socket, message),
      );
      const ack = seen.frames.find(
        (frame) =>
          frame.type === "known_containers_ack" &&
          frame.declarationId === declarationId,
      );
      if (!ack) throw new Error("The declaration was not acknowledged.");
      return { authorized: frameIds(ack), calls: seen.calls };
    },
    /** The socket's periodic re-verification of every installed id. */
    async revalidate() {
      const due = [...timers].filter(
        (timer) => Math.abs(timer.delayMs - TICK_DELAY_MS) <= TICK_WINDOW_MS,
      );
      if (due.length === 0) throw new Error("No revalidation tick is armed.");
      for (const timer of due) timers.delete(timer);
      const seen = await observe(async () => {
        await Promise.all(due.map((timer) => timer.run()));
      });
      if (seen.calls.length === 0 || seen.calls.some((call) => call.failed))
        throw new Error("The revalidation pass did not complete.");
      const evicted = seen.frames
        .filter((frame) => frame.type === "resync_required")
        .reduce((total, frame) => total + frameIds(frame), 0);
      return {
        authorized: seen.calls.at(-1)?.proofs ?? 0,
        evicted,
        calls: seen.calls,
      };
    },
    /** The hibernation snapshot the hub would store for this socket. */
    snapshotSize() {
      const characters = JSON.stringify(
        gateway.hibernation.snapshot(socket),
      ).length;
      return {
        characters,
        chunks: Math.ceil(characters / SNAPSHOT_CHUNK_CHARS),
      };
    },
    close(): void {
      gateway.websocket.close(socket);
      gateway.stop();
    },
  };
}
