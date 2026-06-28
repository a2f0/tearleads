import { expect, test } from "bun:test";
import { createRealtimeGateway } from "./realtimeGateway";
import { MAX_CLIENT_MESSAGE_BYTES } from "./wsRouting";

test("caps websocket client message payloads at the router limit", () => {
  expect(createRealtimeGateway().websocket.maxPayloadLength).toBe(
    MAX_CLIENT_MESSAGE_BYTES,
  );
});
