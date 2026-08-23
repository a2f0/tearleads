import { expect, test } from "bun:test";
import {
  createRouteRequestBindings,
  resolveApiHost,
  resolveWebSocketUpgrade,
} from "./index";
import type { WebSocketTicketIdentity } from "./realtime/wsIdentity";
import {
  createWebSocketTicketConsumer,
  issueWebSocketTicket,
} from "./realtime/wsTicket";

const TEST_SESSION_ID =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440001";

test("the Bun listener is restricted to loopback hosts", () => {
  expect(resolveApiHost()).toBe("127.0.0.1");
  expect(resolveApiHost("127.0.0.1")).toBe("127.0.0.1");
  expect(resolveApiHost("::1")).toBe("::1");
  expect(() => resolveApiHost("localhost")).toThrow(
    "API_HOST must be loopback-only",
  );
  expect(() => resolveApiHost("0.0.0.0")).toThrow(
    "API_HOST must be loopback-only",
  );
});

function websocketUpgradeRequest(ticket?: string, path = "/events"): Request {
  const url = new URL(`http://localhost:3001${path}`);
  if (ticket !== undefined) {
    url.searchParams.set("ticket", ticket);
  }
  return new Request(url, { headers: { upgrade: "websocket" } });
}

test("createRouteRequestBindings exposes the Bun direct client IP", () => {
  const req = new Request("http://localhost:3001/auth/verify");

  const bindings = createRouteRequestBindings(req, {
    requestIP(request) {
      expect(request).toBe(req);
      return { address: "127.0.0.1" };
    },
  });

  expect(bindings).toEqual({ directClientIp: "127.0.0.1" });
});

test("createRouteRequestBindings omits direct client IP when unavailable", () => {
  const bindings = createRouteRequestBindings(
    new Request("http://localhost:3001/auth/verify"),
    {
      requestIP() {
        return null;
      },
    },
  );

  expect(bindings).toEqual({});
});

test("rejects a websocket upgrade with no ticket", async () => {
  let upgradeCalled = false;
  const res = await resolveWebSocketUpgrade(websocketUpgradeRequest(), {
    upgrade() {
      upgradeCalled = true;
      return true;
    },
  });

  expect(res?.status).toBe(401);
  expect(upgradeCalled).toBe(false);
});

test("rejects a websocket upgrade with an unknown ticket", async () => {
  let upgradeCalled = false;
  const res = await resolveWebSocketUpgrade(
    websocketUpgradeRequest("not-a-real-ticket"),
    {
      upgrade() {
        upgradeCalled = true;
        return true;
      },
    },
  );

  expect(res?.status).toBe(401);
  expect(upgradeCalled).toBe(false);
});

test("rejects websocket upgrades outside /events without consuming tickets", async () => {
  let consumeCalled = false;
  let upgradeCalled = false;
  const res = await resolveWebSocketUpgrade(
    websocketUpgradeRequest("ticket-on-wrong-path", "/"),
    {
      upgrade() {
        upgradeCalled = true;
        return true;
      },
    },
    async () => {
      consumeCalled = true;
      return { sessionId: TEST_SESSION_ID, userId: TEST_USER_ID };
    },
  );

  expect(res?.status).toBe(404);
  expect(consumeCalled).toBe(false);
  expect(upgradeCalled).toBe(false);
});

test("upgrades with a valid ticket, binds identity, and consumes it", async () => {
  const identity: WebSocketTicketIdentity = {
    sessionId: TEST_SESSION_ID,
    userId: TEST_USER_ID,
  };
  const ticket = await issueWebSocketTicket(identity);
  const consume = createWebSocketTicketConsumer(async () => true);

  let boundData: unknown;
  const res = await resolveWebSocketUpgrade(
    websocketUpgradeRequest(ticket),
    {
      upgrade(_req, options) {
        boundData = options?.data;
        return true;
      },
    },
    consume,
  );

  expect(res).toBeUndefined();
  expect(boundData).toEqual(identity);

  // The ticket is single-use: a replayed handshake with it is rejected.
  let replayUpgradeCalled = false;
  const replay = await resolveWebSocketUpgrade(
    websocketUpgradeRequest(ticket),
    {
      upgrade() {
        replayUpgradeCalled = true;
        return true;
      },
    },
    consume,
  );
  expect(replay?.status).toBe(401);
  expect(replayUpgradeCalled).toBe(false);
});

test("returns 400 when the upgrade itself fails", async () => {
  const ticket = await issueWebSocketTicket({
    sessionId: TEST_SESSION_ID,
    userId: TEST_USER_ID,
  });
  const consume = createWebSocketTicketConsumer(async () => true);

  const res = await resolveWebSocketUpgrade(
    websocketUpgradeRequest(ticket),
    {
      upgrade() {
        return false;
      },
    },
    consume,
  );

  expect(res?.status).toBe(400);
});

test("createRouteRequestBindings omits direct client IP when Bun cannot resolve it", () => {
  const bindings = createRouteRequestBindings(
    new Request("http://localhost:3001/auth/verify"),
    {
      requestIP() {
        throw new Error("request is not attached to a socket");
      },
    },
  );

  expect(bindings).toEqual({});
});
