import { expect, test } from "bun:test";
import { websocket } from "./ws";
import { MAX_CLIENT_MESSAGE_BYTES } from "./wsRouting";

test("caps websocket client message payloads at the router limit", () => {
  expect(websocket.maxPayloadLength).toBe(MAX_CLIENT_MESSAGE_BYTES);
});
