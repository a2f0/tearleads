import { expect, test } from "bun:test";
import { consumeWebSocketTicket, issueWebSocketTicket } from "./wsTicket";

test("issues a ticket that consumes once to the issued identity", async () => {
  const identity = { sessionId: "session-1", userId: "user-1" };
  const ticket = await issueWebSocketTicket(identity);
  expect(typeof ticket).toBe("string");
  expect(ticket.length).toBeGreaterThan(0);

  expect(await consumeWebSocketTicket(ticket)).toEqual(identity);
  // Single-use: a second consume of the same ticket fails.
  expect(await consumeWebSocketTicket(ticket)).toBeNull();
});

test("rejects empty and never-issued tickets", async () => {
  expect(await consumeWebSocketTicket("")).toBeNull();
  expect(await consumeWebSocketTicket("never-issued-ticket")).toBeNull();
});
