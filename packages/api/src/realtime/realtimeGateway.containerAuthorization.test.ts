import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRealtimeGateway } from "./realtimeGateway";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import { type AppliedInterest, WsEventRouter } from "./wsRouting";

const CONTAINER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

function fixture(input: {
  authorize: (userId: string, ids: string[]) => Promise<string[]>;
  cached?: string[];
}) {
  const sent: Array<Record<string, unknown>> = [];
  const closed: number[] = [];
  const persisted: AppliedInterest[] = [];
  const router = new WsEventRouter();
  let listener: ((message: string) => void) | undefined;
  const socket = {
    data: { userId: "user", sessionId: "session" },
    send: (message: string) => sent.push(JSON.parse(message)),
    close: (code: number) => closed.push(code),
  } as unknown as ServerWebSocket<WebSocketTicketIdentity>;
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: input.authorize,
    interestStore: {
      load: async () => input.cached ?? [],
      apply: async (_userId, _sessionId, action) => {
        persisted.push(action);
      },
    },
    router,
    subscribe: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  });
  gateway.start();
  return {
    closed,
    gateway,
    persisted,
    router,
    sent,
    socket,
    declare(kind = "known_containers.add", ids = [CONTAINER]) {
      return gateway.websocket.message(
        socket,
        JSON.stringify({
          type: kind,
          containerIds: ids,
          declarationId: "declaration",
        }),
      );
    },
    publish(event: Record<string, unknown>) {
      listener?.(JSON.stringify(event));
    },
  };
}

test("container declarations require access before indexing, acknowledgement or persistence", async () => {
  const calls: string[][] = [];
  const f = fixture({
    authorize: async (_user, ids) => {
      calls.push(ids);
      return [];
    },
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare();
  f.publish({
    type: "document_update_created",
    containerIds: [CONTAINER],
    documentId: "secret",
    updateIds: ["update"],
  });
  expect(calls).toEqual([[CONTAINER]]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.closed).toEqual([1008]);
  expect(f.sent).toEqual([{ type: "interest_state", containerIds: [] }]);
  expect(
    f.persisted.some((action) => action?.containerIds.includes(CONTAINER)),
  ).toBe(false);
  f.gateway.stop();
});

test("reconnect reauthorizes cached interest and removes inaccessible ids", async () => {
  const f = fixture({
    cached: [CONTAINER, OTHER],
    authorize: async () => [OTHER],
  });
  await f.gateway.websocket.open(f.socket);
  await Promise.resolve();
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  expect(f.sent).toEqual([{ type: "interest_state", containerIds: [OTHER] }]);
  expect(f.persisted).toContainEqual({
    kind: "replace",
    containerIds: [OTHER],
  });
  f.gateway.stop();
});

test("pending container authorization cannot index a closed socket", async () => {
  const authorization = Promise.withResolvers<string[]>();
  const f = fixture({ authorize: () => authorization.promise });
  await f.gateway.websocket.open(f.socket);
  const pending = f.declare();
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  f.gateway.websocket.close(f.socket);
  authorization.resolve([CONTAINER]);
  await pending;
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.sent).toEqual([{ type: "interest_state", containerIds: [] }]);
  f.gateway.stop();
});

test("a later remove wins over an in-flight add", async () => {
  const authorization = Promise.withResolvers<string[]>();
  const f = fixture({ authorize: () => authorization.promise });
  await f.gateway.websocket.open(f.socket);
  const adding = f.declare();
  const removing = f.declare("known_containers.remove");
  authorization.resolve([CONTAINER]);
  await Promise.all([adding, removing]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.persisted.at(-1)).toMatchObject({
    kind: "remove",
    containerIds: [CONTAINER],
  });
  f.gateway.stop();
});

test("access changes invalidate in-flight authorization and descendant subscriptions", async () => {
  const authorization = Promise.withResolvers<string[]>();
  let calls = 0;
  const f = fixture({
    authorize: () =>
      ++calls === 1 ? authorization.promise : Promise.resolve([]),
  });
  await f.gateway.websocket.open(f.socket);
  const pending = f.declare();
  await Promise.resolve();
  f.publish({ type: "access_changed", containerId: OTHER });
  authorization.resolve([CONTAINER]);
  await pending;
  expect(calls).toBe(2);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  f.gateway.stop();
});
