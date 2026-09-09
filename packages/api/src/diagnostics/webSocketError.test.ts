import { expect, spyOn, test } from "bun:test";
import server from "../index";
import * as tickets from "../realtime/wsTicket";
import * as sentry from "./sentry";

test("the Bun fetch handler reports handshake failures and preserves expected upgrade responses", async () => {
  const error = new Error("SYNTHETIC_PRIVATE_WEBSOCKET_TICKET");
  const consume = spyOn(tickets, "consumeWebSocketTicket").mockRejectedValue(
    error,
  );
  const capture = spyOn(sentry, "captureApiError").mockImplementation(() => {});
  const request = new Request(
    "http://localhost/events?ticket=synthetic-ticket",
    {
      headers: { upgrade: "websocket" },
    },
  );
  const socketServer = {
    requestIP: () => null,
    upgrade: () => false,
  };
  try {
    const failure = await server.fetch(request, socketServer);
    expect(failure?.status).toBe(500);
    expect(await failure?.text()).toBe("Internal Server Error");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(error, "websocket-error");
    capture.mockClear();

    consume.mockResolvedValue(null);
    expect((await server.fetch(request, socketServer))?.status).toBe(401);
    consume.mockResolvedValue({
      sessionId: "synthetic-session",
      userId: "synthetic-user",
    });
    expect((await server.fetch(request, socketServer))?.status).toBe(400);
    expect(
      await server.fetch(request, { ...socketServer, upgrade: () => true }),
    ).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  } finally {
    consume.mockRestore();
    capture.mockRestore();
  }
});
