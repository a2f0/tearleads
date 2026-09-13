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
  const socket = {
    data: { userId, sessionId },
    send: (message: string) => sent.push(JSON.parse(message)),
    close: () => undefined,
  } as unknown as ServerWebSocket<WebSocketTicketIdentity>;
  return { sent, socket };
}

export function fixture(input: {
  authorize: (userId: string, ids: string[]) => Promise<string[]>;
  cached?: string[];
  load?: () => Promise<string[]>;
  paths?: Readonly<Record<string, string[]>>;
  timeoutMs?: number;
  principalKeys?: readonly string[];
  revalidation?: RevalidationScheduleOptions;
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
