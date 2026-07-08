import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRealtimeGateway } from "./realtimeGateway";
import { createSessionRevocationNotifier } from "./sessionRevocation";
import type { SessionData } from "./validators/session";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import type { AppliedInterest } from "./wsRouting";
import { MAX_CLIENT_MESSAGE_BYTES } from "./wsRouting";

interface FakeSocket {
  readonly closed: Array<{
    code: number | undefined;
    reason: string | undefined;
  }>;
  readonly data: WebSocketTicketIdentity;
  readonly sent: string[];
  close(code?: number, reason?: string): void;
  send(message: string): void;
}

function fakeSocket(userId: string, sessionId: string): FakeSocket {
  const closed: FakeSocket["closed"] = [];
  const sent: string[] = [];
  return {
    closed,
    data: { sessionId, userId },
    sent,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
    send(message: string) {
      sent.push(message);
    },
  };
}

function serverSocket(
  ws: FakeSocket,
): ServerWebSocket<WebSocketTicketIdentity> {
  return ws as unknown as ServerWebSocket<WebSocketTicketIdentity>;
}

function createFakeBus() {
  const listeners = new Set<(message: string) => void>();
  return {
    async publish(event: Record<string, unknown>): Promise<void> {
      const message = JSON.stringify(event);
      for (const listener of [...listeners]) {
        try {
          listener(message);
        } catch (error) {
          console.error("Error in fake bus listener:", error);
        }
      }
    },
    subscribe(listener: (message: string) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createMemoryInterestStore() {
  const sets = new Map<string, Set<string>>();
  function key(userId: string, sessionId: string): string {
    return `${userId}:${sessionId}`;
  }
  return {
    async apply(
      userId: string,
      sessionId: string,
      applied: AppliedInterest,
    ): Promise<void> {
      if (!applied) {
        return;
      }
      const interestKey = key(userId, sessionId);
      const current =
        applied.kind === "replace"
          ? new Set<string>()
          : (sets.get(interestKey) ?? new Set<string>());
      for (const containerId of applied.containerIds) {
        if (applied.kind === "remove") {
          current.delete(containerId);
        } else {
          current.add(containerId);
        }
      }
      sets.set(interestKey, current);
    },
    async load(userId: string, sessionId: string): Promise<string[]> {
      return [...(sets.get(key(userId, sessionId)) ?? [])];
    },
  };
}

function sessionData(userId: string, sessionId: string): SessionData {
  return {
    createdAt: 1,
    fingerprint: "f".repeat(64),
    id: sessionId,
    ipAddresses: [],
    lastActiveAt: 1,
    lastActiveIp: null,
    userId,
  };
}

test("caps websocket client message payloads at the router limit", () => {
  expect(createRealtimeGateway().websocket.maxPayloadLength).toBe(
    MAX_CLIENT_MESSAGE_BYTES,
  );
});

test("cross-instance session revocation closes only the revoked session socket", async () => {
  const bus = createFakeBus();
  const socketInstance = createRealtimeGateway({
    interestStore: createMemoryInterestStore(),
    subscribe: bus.subscribe,
  });
  const logoutInstance = createRealtimeGateway({
    interestStore: createMemoryInterestStore(),
    subscribe: bus.subscribe,
  });
  socketInstance.start();
  logoutInstance.start();

  const userId = "11111111-1111-4111-8111-111111111111";
  const revokedSessionId = "a".repeat(64);
  const otherSessionId = "b".repeat(64);
  const otherUserId = "22222222-2222-4222-8222-222222222222";
  const revoked = fakeSocket(userId, revokedSessionId);
  const sameUserOtherSession = fakeSocket(userId, otherSessionId);
  const otherUserSameSessionId = fakeSocket(otherUserId, revokedSessionId);

  await socketInstance.websocket.open(serverSocket(revoked));
  await socketInstance.websocket.open(serverSocket(sameUserOtherSession));
  await socketInstance.websocket.open(serverSocket(otherUserSameSessionId));

  const clearError = new Error("redis timeout");
  const clearErrors: unknown[] = [];
  const notifySessionRevoked = createSessionRevocationNotifier({
    async clearInterest() {
      throw clearError;
    },
    onClearInterestError(error) {
      clearErrors.push(error);
    },
    publishEvent: bus.publish,
  });

  await notifySessionRevoked(sessionData(userId, revokedSessionId));

  expect(clearErrors).toEqual([clearError]);
  expect(revoked.closed).toEqual([{ code: 1008, reason: "Session revoked" }]);
  expect(sameUserOtherSession.closed).toEqual([]);
  expect(otherUserSameSessionId.closed).toEqual([]);

  socketInstance.stop();
  logoutInstance.stop();
});
