import { expect, spyOn, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useServerEventsBinding } from "./serverEventsBinding";

test("same-bearer replacement retires the socket before React restarts the binding", async () => {
  const sdk = new Tearleads();
  const sockets: EventTarget[] = [];
  const log = () => {};
  spyOn(sdk, "requestWebSocketTicket").mockResolvedValue("ticket");
  spyOn(sdk, "openServerEventsSocket").mockImplementation(() => {
    const socket = Object.assign(new EventTarget(), { close() {} });
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const context = { authToken: "same-token", isAuthenticated: true };
  sdk.session.setContext(context);
  const { rerender, unmount } = renderHook(() =>
    useServerEventsBinding(
      sdk,
      "wss://example.test",
      context.authToken,
      log,
      true,
      true,
    ),
  );
  const message = () =>
    new MessageEvent("message", {
      data: JSON.stringify({
        type: "user_registered",
        userId: "user",
        fingerprint: "fingerprint",
      }),
    });
  try {
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => {
      sdk.session.setContext(context);
      sockets[0]?.dispatchEvent(message());
    });
    expect(sdk.events.events).toHaveLength(0);
    rerender();
    await waitFor(() => expect(sockets).toHaveLength(2));
    act(() => {
      sockets[1]?.dispatchEvent(message());
    });
    expect(sdk.events.events).toHaveLength(1);
  } finally {
    unmount();
    sdk.dispose();
  }
});
