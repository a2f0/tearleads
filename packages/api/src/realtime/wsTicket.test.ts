import { expect, test } from "bun:test";
import { set } from "../adapters/keyValueStore";
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

test("stored ticket identities that are malformed fail closed", async () => {
  const valid = { sessionId: TEST_SESSION_ID, userId: TEST_USER_ID };
  const malformed: readonly string[] = [
    "not json",
    "",
    "null",
    "1",
    '"identity"',
    "[]",
    JSON.stringify([valid]),
    JSON.stringify({ userId: TEST_USER_ID }),
    JSON.stringify({ sessionId: TEST_SESSION_ID }),
    JSON.stringify({ ...valid, userId: 1 }),
    JSON.stringify({ ...valid, userId: null }),
    JSON.stringify({ ...valid, userId: "" }),
    JSON.stringify({
      ...valid,
      userId: "550e8400-e29b-11d4-a716-446655440000",
    }),
    JSON.stringify({ ...valid, userId: TEST_USER_ID.toUpperCase() }),
    JSON.stringify({ ...valid, sessionId: 1 }),
    JSON.stringify({ ...valid, sessionId: "session-1" }),
    JSON.stringify({ ...valid, sessionId: TEST_SESSION_ID.toUpperCase() }),
    JSON.stringify({ ...valid, sessionId: `${TEST_SESSION_ID}0` }),
  ];
  let validations = 0;
  const validateSession = async () => {
    validations += 1;
    return true;
  };
  for (const [index, raw] of malformed.entries()) {
    const ticket = index.toString(16).padStart(64, "c");
    await set(`ws-ticket:${ticket}`, raw, 60);
    expect(await consumeWebSocketTicket(ticket, validateSession)).toBeNull();
  }
  expect(validations).toBe(0);

  const extended = "d".repeat(64);
  await set(
    `ws-ticket:${extended}`,
    JSON.stringify({ ...valid, extra: true }),
    60,
  );
  expect(await consumeWebSocketTicket(extended, validateSession)).toEqual(
    valid,
  );
  expect(validations).toBe(1);
});
