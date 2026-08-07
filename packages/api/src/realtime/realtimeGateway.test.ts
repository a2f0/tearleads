import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { SessionData } from "../validators/session";
import { createRealtimeGateway } from "./realtimeGateway";
import { createSessionRevocationNotifier } from "./sessionRevocation";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import type { AppliedInterest } from "./wsRouting";
import { MAX_CLIENT_MESSAGE_BYTES } from "./wsRouting";

const ORGANIZATION_ID = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "10000000-0000-4000-8000-00000000000a";
const DECLARATION_ID = "organization-interest-a";
const CLEAR_DECLARATION_ID = "organization-interest-clear";

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

async function flushAsyncRouting(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

test("rejects unauthorized organization declarations before indexing", async () => {
  const bus = createFakeBus();
  const authorizationCalls: Array<{
    organizationId: string;
    userId: string;
  }> = [];
  const gateway = createRealtimeGateway({
    authorizeOrganizationAccess: async (userId, organizationId) => {
      authorizationCalls.push({ organizationId, userId });
      return false;
    },
    interestStore: createMemoryInterestStore(),
    subscribe: bus.subscribe,
  });
  gateway.start();
  const socket = fakeSocket(USER_ID, "session-a");
  const ws = serverSocket(socket);
  await gateway.websocket.open(ws);

  await gateway.websocket.message(
    ws,
    JSON.stringify({
      type: "known_organizations",
      declarationId: DECLARATION_ID,
      organizationIds: [ORGANIZATION_ID],
    }),
  );
  await bus.publish({
    type: "organization_read_model_changed",
    organizationId: ORGANIZATION_ID,
    recipientUserIds: [USER_ID],
  });
  await flushAsyncRouting();

  expect(authorizationCalls).toEqual([
    { organizationId: ORGANIZATION_ID, userId: USER_ID },
    { organizationId: ORGANIZATION_ID, userId: USER_ID },
  ]);
  expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
    { type: "interest_state", containerIds: [] },
    {
      type: "known_organizations_ack",
      declarationId: DECLARATION_ID,
      organizationId: ORGANIZATION_ID,
      authorized: false,
    },
  ]);
  gateway.stop();
});

test("reauthorizes denied demand when a later audience restores access", async () => {
  const bus = createFakeBus();
  let authorized = false;
  let authorizationCalls = 0;
  const gateway = createRealtimeGateway({
    authorizeOrganizationAccess: async () => {
      authorizationCalls += 1;
      return authorized;
    },
    interestStore: createMemoryInterestStore(),
    subscribe: bus.subscribe,
  });
  gateway.start();
  const socket = fakeSocket(USER_ID, "session-a");
  const ws = serverSocket(socket);
  await gateway.websocket.open(ws);
  await gateway.websocket.message(
    ws,
    JSON.stringify({
      type: "known_organizations",
      declarationId: DECLARATION_ID,
      organizationIds: [ORGANIZATION_ID],
    }),
  );

  await bus.publish({
    type: "organization_read_model_changed",
    organizationId: ORGANIZATION_ID,
    recipientUserIds: [USER_ID],
  });
  await flushAsyncRouting();
  expect(authorizationCalls).toBe(2);
  expect(socket.sent).toHaveLength(2);

  authorized = true;
  await bus.publish({
    type: "organization_read_model_changed",
    organizationId: ORGANIZATION_ID,
    recipientUserIds: [USER_ID],
  });
  await flushAsyncRouting();

  expect(authorizationCalls).toBe(3);
  expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
    { type: "interest_state", containerIds: [] },
    {
      type: "known_organizations_ack",
      declarationId: DECLARATION_ID,
      organizationId: ORGANIZATION_ID,
      authorized: false,
    },
    {
      type: "organization_read_model_changed",
      organizationId: ORGANIZATION_ID,
      originatedFromSession: false,
    },
  ]);
  gateway.stop();
});

test("does not index an organization until asynchronous authorization resolves", async () => {
  const bus = createFakeBus();
  let resolveAuthorization: ((authorized: boolean) => void) | undefined;
  const authorization = new Promise<boolean>((resolve) => {
    resolveAuthorization = resolve;
  });
  const gateway = createRealtimeGateway({
    authorizeOrganizationAccess: () => authorization,
    interestStore: createMemoryInterestStore(),
    subscribe: bus.subscribe,
  });
  gateway.start();
  const socket = fakeSocket(USER_ID, "session-a");
  const ws = serverSocket(socket);
  await gateway.websocket.open(ws);

  const declaration = gateway.websocket.message(
    ws,
    JSON.stringify({
      type: "known_organizations",
      declarationId: DECLARATION_ID,
      organizationIds: [ORGANIZATION_ID],
    }),
  );
  await bus.publish({
    type: "organization_read_model_changed",
    organizationId: ORGANIZATION_ID,
    recipientUserIds: [USER_ID],
  });
  expect(socket.sent).toHaveLength(1);

  resolveAuthorization?.(true);
  await declaration;
  await flushAsyncRouting();

  expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
    { type: "interest_state", containerIds: [] },
    {
      type: "known_organizations_ack",
      declarationId: DECLARATION_ID,
      organizationId: ORGANIZATION_ID,
      authorized: true,
    },
    {
      type: "organization_read_model_changed",
      organizationId: ORGANIZATION_ID,
      originatedFromSession: false,
    },
  ]);
  gateway.stop();
});

test("a newer clear declaration defeats stale asynchronous authorization", async () => {
  const bus = createFakeBus();
  let resolveAuthorization: ((authorized: boolean) => void) | undefined;
  const authorization = new Promise<boolean>((resolve) => {
    resolveAuthorization = resolve;
  });
  const gateway = createRealtimeGateway({
    authorizeOrganizationAccess: () => authorization,
    interestStore: createMemoryInterestStore(),
    subscribe: bus.subscribe,
  });
  gateway.start();
  const socket = fakeSocket(USER_ID, "session-a");
  const ws = serverSocket(socket);
  await gateway.websocket.open(ws);

  const staleDeclaration = gateway.websocket.message(
    ws,
    JSON.stringify({
      type: "known_organizations",
      declarationId: DECLARATION_ID,
      organizationIds: [ORGANIZATION_ID],
    }),
  );
  await gateway.websocket.message(
    ws,
    JSON.stringify({
      type: "known_organizations",
      declarationId: CLEAR_DECLARATION_ID,
      organizationIds: [],
    }),
  );
  resolveAuthorization?.(true);
  await staleDeclaration;
  await bus.publish({
    type: "organization_read_model_changed",
    organizationId: ORGANIZATION_ID,
    recipientUserIds: [USER_ID],
  });

  expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
    { type: "interest_state", containerIds: [] },
    {
      type: "known_organizations_ack",
      declarationId: CLEAR_DECLARATION_ID,
      organizationId: null,
      authorized: true,
    },
  ]);
  gateway.stop();
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
