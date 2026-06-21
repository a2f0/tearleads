import { expect, test } from "bun:test";
import { createRouteRequestBindings, resolveWebSocketUpgrade } from "./index";
import type { WebSocketTicketIdentity } from "./wsTicket";
import { issueWebSocketTicket } from "./wsTicket";

function websocketUpgradeRequest(ticket?: string): Request {
  const url = new URL("http://localhost:3001/events");
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

test("upgrades with a valid ticket, binds identity, and consumes it", async () => {
  const identity: WebSocketTicketIdentity = {
    sessionId: "session-upgrade",
    userId: "user-upgrade",
  };
  const ticket = await issueWebSocketTicket(identity);

  let boundData: unknown;
  const res = await resolveWebSocketUpgrade(websocketUpgradeRequest(ticket), {
    upgrade(_req, options) {
      boundData = options?.data;
      return true;
    },
  });

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
  );
  expect(replay?.status).toBe(401);
  expect(replayUpgradeCalled).toBe(false);
});

test("returns 400 when the upgrade itself fails", async () => {
  const ticket = await issueWebSocketTicket({
    sessionId: "session-fail",
    userId: "user-fail",
  });

  const res = await resolveWebSocketUpgrade(websocketUpgradeRequest(ticket), {
    upgrade() {
      return false;
    },
  });

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
