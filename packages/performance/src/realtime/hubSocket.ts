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

export interface Frame {
  readonly type?: unknown;
  readonly declarationId?: unknown;
  readonly containerIds?: unknown;
  readonly documentId?: unknown;
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

export type ProbeSocket = ReturnType<ProbeHub["openSocket"]>;

/**
 * One realtime gateway, as the hub runs it, with the hub's real
 * authorization and routing. Every socket opened on it shares its thread,
 * as every socket shares the one global hub in production. Revalidation
 * ticks fire only when the probe asks for them.
 */
export function createProbeHub(api: InProcessApi) {
  const timers = new Set<ArmedTimer>();
  const calls: AuthorizationCall[] = [];
  const gateway = createProbeGateway(api, timers, calls);
  const open = new Set<GatewaySocket>();

  /** Removes and returns every armed revalidation tick. */
  function takeDueTicks(): ArmedTimer[] {
    const due = [...timers].filter(
      (timer) => Math.abs(timer.delayMs - TICK_DELAY_MS) <= TICK_WINDOW_MS,
    );
    if (due.length === 0) throw new Error("No revalidation tick is armed.");
    for (const timer of due) timers.delete(timer);
    return due;
  }

  function openSocket(userId: string) {
    const frames: Frame[] = [];
    const listeners = new Set<(frame: Frame) => void>();
    const socket: GatewaySocket = {
      data: { userId, sessionId: crypto.randomUUID() },
      send: (message: string) => {
        // The gateway sends only serialized server messages, all objects.
        const frame: Frame = JSON.parse(message);
        frames.push(frame);
        for (const listener of listeners) listener(frame);
      },
      close: () => undefined,
    };
    gateway.websocket.open(socket);
    open.add(socket);
    return {
      frames,
      /** Calls `listener` with every frame the hub sends this socket. */
      listen(listener: (frame: Frame) => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      /** A full `known_containers` replace, answered by its acknowledgement. */
      async declare(ids: readonly string[]): Promise<{ authorized: number }> {
        const declarationId = crypto.randomUUID();
        const firstFrame = frames.length;
        await gateway.websocket.message(
          socket,
          JSON.stringify({
            type: "known_containers",
            declarationId,
            containerIds: ids,
          }),
        );
        const ack = frames
          .slice(firstFrame)
          .find(
            (frame) =>
              frame.type === "known_containers_ack" &&
              frame.declarationId === declarationId,
          );
        if (!ack) throw new Error("The declaration was not acknowledged.");
        return { authorized: frameIds(ack) };
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
        if (open.delete(socket)) gateway.websocket.close(socket);
      },
    };
  }

  return {
    calls,
    openSocket,
    /** Hands the hub one pub/sub message, as the Worker does on publish. */
    publish: (message: string) => gateway.publish(message),
    /**
     * Fires every armed revalidation tick at once, the worst alignment of
     * the sockets' jittered passes, and resolves with each tick's duration.
     */
    async revalidateAll(): Promise<number[]> {
      const due = takeDueTicks();
      return await Promise.all(
        due.map(async (timer) => {
          const started = performance.now();
          await timer.run();
          return performance.now() - started;
        }),
      );
    },
    /** Closes every socket still open, then the gateway. */
    stop(): void {
      for (const socket of open) gateway.websocket.close(socket);
      open.clear();
      gateway.stop();
    },
  };
}

type ProbeHub = ReturnType<typeof createProbeHub>;

/**
 * One socket on a fresh realtime gateway. The revalidation tick fires only
 * when the probe asks for it.
 */
export function openHubSocket(api: InProcessApi, userId: string) {
  const hub = createProbeHub(api);
  const socket = hub.openSocket(userId);

  /** Authorization calls made by `work`, and the frames it sent. */
  async function observe(work: () => Promise<void>) {
    const firstCall = hub.calls.length;
    const firstFrame = socket.frames.length;
    await work();
    return {
      calls: hub.calls.slice(firstCall),
      frames: socket.frames.slice(firstFrame),
    };
  }

  return {
    async declare(ids: readonly string[]) {
      let authorized = 0;
      const seen = await observe(async () => {
        ({ authorized } = await socket.declare(ids));
      });
      return { authorized, calls: seen.calls };
    },
    /** The socket's periodic re-verification of every installed id. */
    async revalidate() {
      const seen = await observe(async () => {
        await hub.revalidateAll();
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
    snapshotSize: socket.snapshotSize,
    close(): void {
      hub.stop();
    },
  };
}
