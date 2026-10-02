import type { ServerWebSocket } from "bun";
import type { RevalidationScheduleOptions } from "../../src/realtime/containerInterestRevalidation";
import { createRealtimeGateway } from "../../src/realtime/realtimeGateway";
import type { WebSocketTicketIdentity } from "../../src/realtime/wsIdentity";
import {
  type AppliedInterest,
  WsEventRouter,
} from "../../src/realtime/wsRouting";

export const CONTAINER = "00000000-0000-4000-8000-000000000001";
export const OTHER = "00000000-0000-4000-8000-000000000002";

/** A second recording socket for tests that need distinct recipients. */
export function recordingSocket(userId: string, sessionId: string) {
  const sent: Array<Record<string, unknown>> = [];
  const closed: Array<{
    code: number | undefined;
    reason: string | undefined;
  }> = [];
  const socket = {
    data: { userId, sessionId },
    send: (message: string) => sent.push(JSON.parse(message)),
    close: (code?: number, reason?: string) => closed.push({ code, reason }),
  } as unknown as ServerWebSocket<WebSocketTicketIdentity>;
  return { closed, sent, socket };
}

const flushTasks = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A clock and timer source for `RevalidationScheduleOptions`: `advance` runs
 * every timer that falls due, in order, including ones armed along the way.
 */
export function virtualClock() {
  let now = 0;
  const timers = new Set<{ readonly at: number; readonly run: () => void }>();
  return {
    now: () => now,
    /** Timers still armed, whether or not they are due yet. */
    pending: () => timers.size,
    schedule: (run: () => void, delayMs: number) => {
      const timer = { at: now + delayMs, run };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    async advance(ms: number): Promise<void> {
      const until = now + ms;
      for (;;) {
        let due: { readonly at: number; readonly run: () => void } | undefined;
        for (const timer of timers) {
          if (timer.at <= until && (!due || timer.at < due.at)) due = timer;
        }
        if (!due) break;
        timers.delete(due);
        now = due.at;
        due.run();
        await flushTasks();
        await flushTasks();
      }
      now = until;
    },
  };
}

export function fixture(input: {
  authorize: (userId: string, ids: string[]) => Promise<string[]>;
  cached?: string[];
  load?: () => Promise<string[]>;
  paths?: Readonly<Record<string, string[]>>;
  timeoutMs?: number;
  principalKeys?: readonly string[];
  revalidation?: RevalidationScheduleOptions;
  /** Defaults to a live session; a test ends it to check the socket closes. */
  sessionLive?: () => boolean;
  sessionReadTimeoutMs?: number;
  /** Replaces the session check outright, e.g. with a read that never ends. */
  validateSession?: (identity: WebSocketTicketIdentity) => Promise<boolean>;
}) {
  const sent: Array<Record<string, unknown>> = [];
  const closed: number[] = [];
  const persisted: AppliedInterest[] = [];
  const router = new WsEventRouter();
  let listener: ((message: string) => void) | undefined;
  let reconnectListener: (() => void) | undefined;
  const socket = {
    data: { userId: "user", sessionId: "session" },
    send: (message: string) => sent.push(JSON.parse(message)),
    close: (code: number) => closed.push(code),
  } as unknown as ServerWebSocket<WebSocketTicketIdentity>;
  const gateway = createRealtimeGateway({
    // Disabled unless a test opts in; timers must not outlive the fixture.
    revalidation: input.revalidation ?? { intervalMs: 0 },
    subscribeReconnect: (callback) => {
      reconnectListener = callback;
      return () => {
        reconnectListener = undefined;
      };
    },
    authorizeContainerAccess: async (userId, ids) =>
      (await input.authorize(userId, ids)).map((containerId) => ({
        containerId,
        principalKeys: input.principalKeys ?? [],
        pathContainerIds: input.paths?.[containerId] ?? [containerId],
      })),
    ...(input.timeoutMs === undefined
      ? {}
      : { containerAuthorizationTimeoutMs: input.timeoutMs }),
    interestStore: {
      load: input.load ?? (async () => input.cached ?? []),
      apply: async (_userId, _sessionId, action) => {
        persisted.push(action);
      },
    },
    router,
    subscribe: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    ...(input.sessionReadTimeoutMs === undefined
      ? {}
      : { sessionReadTimeoutMs: input.sessionReadTimeoutMs }),
    validateSession:
      input.validateSession ?? (async () => input.sessionLive?.() ?? true),
  });
  gateway.start();
  return {
    closed,
    gateway,
    persisted,
    router,
    sent,
    socket,
    declare(
      kind = "known_containers.add",
      ids = [CONTAINER],
      connection = socket,
    ) {
      return gateway.websocket.message(
        connection,
        JSON.stringify({
          type: kind,
          containerIds: ids,
          declarationId: "declaration",
        }),
      );
    },
    publish(event: Record<string, unknown>) {
      listener?.(JSON.stringify(event));
    },
    reconnect() {
      reconnectListener?.();
    },
  };
}
