import { expect, test } from "bun:test";
import { consumeWebSocketTicket, issueWebSocketTicket } from "./wsTicket";

const TEST_SESSION_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000";

test("issues a ticket that consumes once to the issued identity", async () => {
  const identity = { sessionId: TEST_SESSION_ID, userId: TEST_USER_ID };
  const ticket = await issueWebSocketTicket(identity);
  expect(typeof ticket).toBe("string");
  expect(ticket).toMatch(/^[0-9a-f]{64}$/);

  const validateSession = async () => true;
  expect(await consumeWebSocketTicket(ticket, validateSession)).toEqual(
    identity,
  );
  // Single-use: a second consume of the same ticket fails.
  expect(await consumeWebSocketTicket(ticket, validateSession)).toBeNull();
});

test("rejects malformed and never-issued tickets", async () => {
  expect(await consumeWebSocketTicket("")).toBeNull();
  expect(await consumeWebSocketTicket("never-issued-ticket")).toBeNull();
  expect(
    await consumeWebSocketTicket(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!",
    ),
  ).toBeNull();
});

test("rejects tickets when the backing session is no longer live", async () => {
  const ticket = await issueWebSocketTicket({
    sessionId: TEST_SESSION_ID,
    userId: TEST_USER_ID,
  });

  expect(await consumeWebSocketTicket(ticket, async () => false)).toBeNull();
  // The rejected ticket was still consumed atomically.
  expect(await consumeWebSocketTicket(ticket, async () => true)).toBeNull();
});

test("rejects invalid ticket identities before storage", async () => {
  await expect(
    issueWebSocketTicket({ sessionId: "session-1", userId: TEST_USER_ID }),
  ).rejects.toThrow("WebSocket ticket identity must reference a live session");
});
