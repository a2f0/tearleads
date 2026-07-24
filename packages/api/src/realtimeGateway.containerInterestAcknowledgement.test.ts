import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRealtimeGateway } from "./realtimeGateway";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import type { AppliedInterest } from "./wsRouting";
import { WsEventRouter } from "./wsRouting";

const CONTAINER_ID = "00000000-0000-4000-8000-000000000001";

test("container interest routing is active before acknowledgement and persistence", async () => {
  const router = new WsEventRouter();
  let persistenceStarted = false;
  let routingActiveAtAcknowledgement = false;
  let persistenceStartedAtAcknowledgement = false;
  const sent: string[] = [];
  const socket = {
    close: () => undefined,
    data: { sessionId: "session-a", userId: "user-a" },
    send(message: string) {
      sent.push(message);
      const parsed = JSON.parse(message) as { type?: unknown };
      if (parsed.type === "known_containers_ack") {
        routingActiveAtAcknowledgement =
          router.interestedSocketCount(CONTAINER_ID) === 1;
        persistenceStartedAtAcknowledgement = persistenceStarted;
      }
    },
  } as unknown as ServerWebSocket<WebSocketTicketIdentity>;
  const gateway = createRealtimeGateway({
    interestStore: {
      async apply(
        _userId: string,
        _sessionId: string,
        _applied: AppliedInterest,
      ) {
        persistenceStarted = true;
      },
      async load() {
        return [];
      },
    },
    router,
    subscribe: () => () => undefined,
  });

  await gateway.websocket.open(socket);
  await gateway.websocket.message(
    socket,
    JSON.stringify({
      type: "known_containers.add",
      containerIds: [CONTAINER_ID],
      declarationId: "interest-1",
    }),
  );

  expect(sent.map((message) => JSON.parse(message))).toEqual([
    { type: "interest_state", containerIds: [] },
    { type: "known_containers_ack", declarationId: "interest-1" },
  ]);
  expect(routingActiveAtAcknowledgement).toBe(true);
  expect(persistenceStartedAtAcknowledgement).toBe(false);
  await Promise.resolve();
  expect(persistenceStarted).toBe(true);
});
