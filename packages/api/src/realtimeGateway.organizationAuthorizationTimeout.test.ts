import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRealtimeGateway } from "./realtimeGateway";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import type { AppliedInterest } from "./wsRouting";
import { WsEventRouter } from "./wsRouting";

const ORGANIZATION_ID = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "10000000-0000-4000-8000-00000000000a";
const SECOND_USER_ID = "20000000-0000-4000-8000-00000000000a";
const DECLARATION_ID = "organization-interest-a";

interface FakeSocket {
  readonly data: WebSocketTicketIdentity;
  readonly sent: string[];
  send(message: string): void;
}

function fakeSocket(userId: string, sessionId: string): FakeSocket {
  const sent: string[] = [];
  return {
    data: { sessionId, userId },
    sent,
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

function createInterestStore() {
  return {
    async apply(
      _userId: string,
      _sessionId: string,
      _applied: AppliedInterest,
    ): Promise<void> {},
    async load(): Promise<string[]> {
      return [];
    },
  };
}

function createFakeBus() {
  const listeners = new Set<(message: string) => void>();
  return {
    async publish(event: Record<string, unknown>): Promise<void> {
      const message = JSON.stringify(event);
      for (const listener of [...listeners]) {
        listener(message);
      }
    },
    subscribe(listener: (message: string) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function flushAsyncRouting(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Timed out waiting for asynchronous routing.")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function waitForSentMessageCount(
  socket: FakeSocket,
  expectedCount: number,
): Promise<void> {
  await settleWithin(
    (async () => {
      while (socket.sent.length < expectedCount) {
        await flushAsyncRouting();
      }
    })(),
  );
}

test("authorization timeout acknowledges denial and leaves late success inert", async () => {
  let resolveAuthorization: ((authorized: boolean) => void) | undefined;
  const authorization = new Promise<boolean>((resolve) => {
    resolveAuthorization = resolve;
  });
  const router = new WsEventRouter();
  const gateway = createRealtimeGateway({
    authorizeOrganizationAccess: () => authorization,
    interestStore: createInterestStore(),
    organizationAuthorizationTimeoutMs: 5,
    router,
  });
  const socket = fakeSocket(USER_ID, "session-a");
  const ws = serverSocket(socket);
  await gateway.websocket.open(ws);

  await settleWithin(
    gateway.websocket.message(
      ws,
      JSON.stringify({
        type: "known_organizations",
        declarationId: DECLARATION_ID,
        organizationIds: [ORGANIZATION_ID],
      }),
    ),
  );
  expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
    { type: "interest_state", containerIds: [] },
    {
      type: "known_organizations_ack",
      declarationId: DECLARATION_ID,
      organizationId: ORGANIZATION_ID,
      authorized: false,
    },
  ]);

  resolveAuthorization?.(true);
  await flushAsyncRouting();
  router.routeServerEvent(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: ORGANIZATION_ID,
      recipientUserIds: [USER_ID],
    }),
  );
  expect(socket.sent).toHaveLength(2);
  gateway.stop();
});

test("a stalled declaration cannot strand events for authorized recipients", async () => {
  const bus = createFakeBus();
  const neverAuthorized = new Promise<boolean>(() => undefined);
  const gateway = createRealtimeGateway({
    authorizeOrganizationAccess: (userId) =>
      userId === USER_ID ? Promise.resolve(true) : neverAuthorized,
    interestStore: createInterestStore(),
    organizationAuthorizationTimeoutMs: 5,
    subscribe: bus.subscribe,
  });
  gateway.start();
  const authorizedSocket = fakeSocket(USER_ID, "session-a");
  const stalledSocket = fakeSocket(SECOND_USER_ID, "session-b");
  const authorizedWs = serverSocket(authorizedSocket);
  const stalledWs = serverSocket(stalledSocket);
  await Promise.all([
    gateway.websocket.open(authorizedWs),
    gateway.websocket.open(stalledWs),
  ]);
  await gateway.websocket.message(
    authorizedWs,
    JSON.stringify({
      type: "known_organizations",
      declarationId: DECLARATION_ID,
      organizationIds: [ORGANIZATION_ID],
    }),
  );
  const stalledDeclaration = gateway.websocket.message(
    stalledWs,
    JSON.stringify({
      type: "known_organizations",
      declarationId: "organization-interest-b",
      organizationIds: [ORGANIZATION_ID],
    }),
  );

  await bus.publish({
    type: "organization_read_model_changed",
    organizationId: ORGANIZATION_ID,
    recipientUserIds: [USER_ID, SECOND_USER_ID],
  });
  await settleWithin(stalledDeclaration);
  await waitForSentMessageCount(authorizedSocket, 3);

  expect(authorizedSocket.sent.map((message) => JSON.parse(message))).toEqual([
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
  expect(stalledSocket.sent.map((message) => JSON.parse(message))).toEqual([
    { type: "interest_state", containerIds: [] },
    {
      type: "known_organizations_ack",
      declarationId: "organization-interest-b",
      organizationId: ORGANIZATION_ID,
      authorized: false,
    },
  ]);
  gateway.stop();
});
