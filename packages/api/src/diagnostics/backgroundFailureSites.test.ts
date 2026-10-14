import { expect, spyOn, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { createDestroySession } from "../middleware/session";
import { createRealtimeGateway } from "../realtime/realtimeGateway";
import type { WebSocketTicketIdentity } from "../realtime/wsIdentity";
import { publishBestEffort } from "../utils/publishBestEffort";
import type { SessionData } from "../validators/session";
import * as background from "./reportBackgroundFailure";

const CONTAINER_ID = "00000000-0000-4000-8000-00000000000b";
const USER_ID = "10000000-0000-4000-8000-00000000000a";

const session: SessionData = {
  createdAt: 1,
  fingerprint: "f".repeat(64),
  id: "a".repeat(64),
  ipAddresses: [],
  lastActiveAt: 1,
  lastActiveIp: null,
  userId: USER_ID,
};

function watchReports() {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const report = spyOn(
    background,
    "reportBackgroundFailure",
  ).mockImplementation(() => undefined);
  return {
    log,
    report,
    restore: () => {
      report.mockRestore();
      log.mockRestore();
    },
  };
}

function socket(sessionId: string) {
  const sent: string[] = [];
  const ws = {
    data: { sessionId, userId: USER_ID },
    send: (message: string) => sent.push(message),
  } as unknown as ServerWebSocket<WebSocketTicketIdentity>;
  return { sent, ws };
}

test("a broker outage on a committed write is reported without failing the write", async () => {
  const watch = watchReports();
  const failure = new Error("SYNTHETIC_PRIVATE_BROKER_VALUE");
  try {
    expect(
      await publishBestEffort(
        async () => {
          throw failure;
        },
        { type: "session_revoked", sessionId: session.id, userId: USER_ID },
        "session revocation",
      ),
    ).toBeUndefined();
    expect(watch.log).toHaveBeenCalledTimes(1);
    expect(watch.report).toHaveBeenCalledWith(failure, "realtime.publish");
  } finally {
    watch.restore();
  }
});

test("a failed revocation fan-out is reported and still completes the logout", async () => {
  const watch = watchReports();
  const failure = new Error("SYNTHETIC_PRIVATE_REVOCATION_VALUE");
  const token = "b".repeat(64);
  const destroySession = createDestroySession(
    async (key) =>
      key === `session:${token}` ? JSON.stringify(session) : null,
    async () => {},
    async () => {},
    async () => {
      throw failure;
    },
  );
  const app = new Hono();
  app.post("/logout", async (c) => {
    await destroySession(c);
    return c.body(null, 204);
  });
  try {
    const response = await app.request("/logout", {
      headers: { Authorization: `Bearer ${token}` },
      method: "POST",
    });
    expect(response.status).toBe(204);
    expect(watch.log).toHaveBeenCalledTimes(1);
    expect(watch.report).toHaveBeenCalledWith(failure, "session.revoke");
  } finally {
    watch.restore();
  }
});

test("a post-handshake container authorization failure is reported and closes the socket", async () => {
  const watch = watchReports();
  const failure = new Error("SYNTHETIC_PRIVATE_INTEREST_VALUE");
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async () => {
      throw failure;
    },
    subscribe: () => () => undefined,
  });
  const { sent, ws } = socket("session-a");
  try {
    gateway.websocket.open(ws);
    await gateway.websocket.message(
      ws,
      JSON.stringify({
        type: "known_containers",
        containerIds: [CONTAINER_ID],
        declarationId: "container-interest-a",
      }),
    );
    expect(sent).toEqual([]);
    expect(watch.report).toHaveBeenCalledTimes(1);
    expect(watch.report).toHaveBeenCalledWith(failure, "websocket.operation");
  } finally {
    watch.restore();
    gateway.stop();
  }
});

test("an organization authorization failure is reported and denies the declaration", async () => {
  const watch = watchReports();
  const failure = new Error("SYNTHETIC_PRIVATE_ACCESS_VALUE");
  const gateway = createRealtimeGateway({
    authorizeOrganizationAccess: async () => {
      throw failure;
    },
    subscribe: () => () => undefined,
  });
  const { sent, ws } = socket("session-b");
  try {
    gateway.websocket.open(ws);
    await gateway.websocket.message(
      ws,
      JSON.stringify({
        type: "known_organizations",
        declarationId: "organization-interest-a",
        organizationIds: [CONTAINER_ID],
      }),
    );
    expect(JSON.parse(sent[0] ?? "{}")).toEqual({
      type: "known_organizations_ack",
      declarationId: "organization-interest-a",
      organizationId: CONTAINER_ID,
      authorized: false,
    });
    expect(watch.log).toHaveBeenCalledTimes(1);
    expect(watch.report).toHaveBeenCalledWith(failure, "websocket.authorize");
  } finally {
    watch.restore();
  }
});
