import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRealtimeGateway } from "./realtimeGateway";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import { WsEventRouter } from "./wsRouting";

const CONTAINER_ID = "00000000-0000-4000-8000-000000000001";

test("container interest routing is active before its acknowledgement", async () => {
  const router = new WsEventRouter();
  let routingActiveAtAcknowledgement = false;
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
      }
    },
  } as unknown as ServerWebSocket<WebSocketTicketIdentity>;
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((containerId) => ({
        containerId,
        pathContainerIds: [containerId],
        principalKeys: [],
      })),
    router,
    subscribe: () => () => undefined,
  });

  gateway.websocket.open(socket);
  await gateway.websocket.message(
    socket,
    JSON.stringify({
      type: "known_containers.add",
      containerIds: [CONTAINER_ID],
      declarationId: "interest-1",
    }),
  );

  // Opening sends nothing; the acknowledgement is the first frame and the
  // client's ordering barrier.
  expect(sent.map((message) => JSON.parse(message))).toEqual([
    {
      type: "known_containers_ack",
      declarationId: "interest-1",
      containerIds: [CONTAINER_ID],
    },
  ]);
  expect(routingActiveAtAcknowledgement).toBe(true);
  gateway.stop();
});
