import { expect, test } from "bun:test";
import { type WsConnection, WsEventRouter } from "./wsRouting";

const CONTAINER_ID = "00000000-0000-4000-8000-000000000001";

function fakeSocket(): WsConnection {
  return {
    close: () => undefined,
    data: { sessionId: "session-a", userId: "user-a" },
    send: () => undefined,
  };
}

test("container interest supports optional bounded declaration ids", () => {
  const router = new WsEventRouter();
  const socket = fakeSocket();
  router.open(socket);

  expect(
    router.handleClientMessage(
      socket,
      JSON.stringify({
        type: "known_containers.add",
        containerIds: [CONTAINER_ID],
        declarationId: "interest-1",
      }),
    ),
  ).toEqual({
    containerIds: [CONTAINER_ID],
    declarationId: "interest-1",
    kind: "add",
  });
  expect(
    router.handleClientMessage(
      socket,
      JSON.stringify({
        type: "known_containers.remove",
        containerIds: [CONTAINER_ID],
      }),
    ),
  ).toEqual({ containerIds: [CONTAINER_ID], kind: "remove" });
});

test("container interest rejects invalid declaration ids before changing routing", () => {
  for (const declarationId of [null, 7, "", "x".repeat(129)]) {
    const router = new WsEventRouter();
    const socket = fakeSocket();
    router.open(socket);

    expect(
      router.handleClientMessage(
        socket,
        JSON.stringify({
          type: "known_containers.add",
          containerIds: [CONTAINER_ID],
          declarationId,
        }),
      ),
    ).toBeNull();
    expect(router.interestedSocketCount(CONTAINER_ID)).toBe(0);
  }
});
