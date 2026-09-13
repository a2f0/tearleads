import { expect, spyOn, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import * as sentry from "../diagnostics/sentry";
import { createRealtimeGateway } from "./realtimeGateway";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import { type AppliedInterest, WsEventRouter } from "./wsRouting";

const CONTAINER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

function fixture(input: {
  authorize: (userId: string, ids: string[]) => Promise<string[]>;
  cached?: string[];
  paths?: Readonly<Record<string, string[]>>;
  timeoutMs?: number;
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
    authorizeContainerAccess: async (userId, ids) =>
      (await input.authorize(userId, ids)).map((containerId) => ({
        containerId,
        pathContainerIds: input.paths?.[containerId] ?? [containerId],
      })),
    ...(input.timeoutMs === undefined
      ? {}
      : { containerAuthorizationTimeoutMs: input.timeoutMs }),
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
    declare(
      kind = "known_containers.add",
      ids = [CONTAINER],
      connection = socket,
    ) {
      return gateway.websocket.message(
        connection,
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

test("denied declarations acknowledge processing without indexing or persisting inaccessible ids", async () => {
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
  expect(f.closed).toEqual([]);
  expect(f.sent).toContainEqual({
    type: "known_containers_ack",
    declarationId: "declaration",
  });
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
  const started = Promise.withResolvers<void>();
  const f = fixture({
    authorize: () => {
      started.resolve();
      return authorization.promise;
    },
  });
  await f.gateway.websocket.open(f.socket);
  const pending = f.declare();
  await started.promise;
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  f.gateway.websocket.close(f.socket);
  authorization.resolve([CONTAINER]);
  await pending;
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.sent).toEqual([{ type: "interest_state", containerIds: [] }]);
  expect(f.persisted).toEqual([]);
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

test("ancestor changes invalidate in-flight authorization", async () => {
  const started = Promise.withResolvers<void>();
  const authorization = Promise.withResolvers<string[]>();
  let calls = 0;
  const f = fixture({
    paths: { [CONTAINER]: [OTHER, CONTAINER] },
    authorize: () => {
      started.resolve();
      return ++calls === 1 ? authorization.promise : Promise.resolve([]);
    },
  });
  await f.gateway.websocket.open(f.socket);
  const pending = f.declare();
  await started.promise;
  f.publish({ type: "access_changed", containerId: OTHER });
  authorization.resolve([CONTAINER]);
  await pending;
  expect(calls).toBe(2);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.closed).toEqual([]);
  expect(f.sent.at(-1)).toEqual({
    type: "known_containers_ack",
    declarationId: "declaration",
  });
  f.gateway.stop();
});

test("an unrelated access change preserves authorized interest", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  await f.gateway.websocket.open(f.socket);
  await f.declare();
  f.publish({ type: "access_changed", containerId: OTHER });
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  expect(
    f.sent.some(
      (message) => Reflect.get(message, "type") === "resync_required",
    ),
  ).toBe(false);
  f.gateway.stop();
});

test("a mixed initial declaration filters revoked IDs and remains usable for reconciliation", async () => {
  const f = fixture({ authorize: async () => [OTHER] });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER, OTHER]);
  expect(f.closed).toEqual([]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  expect(f.sent.at(-1)).toEqual({
    type: "known_containers_ack",
    declarationId: "declaration",
  });
  await f.declare("known_containers.remove", [CONTAINER]);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  expect(
    f.persisted.some(
      (action) =>
        action?.kind !== "remove" && action?.containerIds.includes(CONTAINER),
    ),
  ).toBe(false);
  f.gateway.stop();
});

test("ancestor eviction reaches descendants and does not affect an unrelated tenant", async () => {
  const f = fixture({
    paths: { [CONTAINER]: [OTHER, CONTAINER] },
    authorize: async (_user, ids) => ids,
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare();
  const unrelatedId = "00000000-0000-4000-8000-000000000003";
  const unrelated = {
    ...f.socket,
    data: { userId: "unrelated", sessionId: "unrelated" },
  };
  await f.gateway.websocket.open(unrelated);
  await f.declare("known_containers", [unrelatedId], unrelated);
  f.publish({ type: "access_changed", containerId: OTHER });
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(unrelatedId)).toBe(1);
  expect(
    f.sent.filter(
      (message) => Reflect.get(message, "type") === "resync_required",
    ),
  ).toEqual([{ type: "resync_required", containerId: CONTAINER }]);
  f.gateway.stop();
});

test("unrelated access changes do not restart an in-flight authorization", async () => {
  const started = Promise.withResolvers<void>();
  const authorization = Promise.withResolvers<string[]>();
  let calls = 0;
  const f = fixture({
    authorize: () => {
      calls++;
      started.resolve();
      return authorization.promise;
    },
  });
  await f.gateway.websocket.open(f.socket);
  const pending = f.declare();
  await started.promise;
  f.publish({ type: "access_changed", containerId: OTHER });
  authorization.resolve([CONTAINER]);
  await pending;
  expect(calls).toBe(1);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  f.gateway.stop();
});

test("authorization errors report and close without indexing or persistence", async () => {
  const failure = new Error("Unavailable authorization database");
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const f = fixture({
    authorize: async () => {
      throw failure;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    expect(capture).toHaveBeenCalledWith(failure, "background-error");
    expect(f.closed).toEqual([1011]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.persisted).toEqual([]);
    expect(f.sent).toEqual([{ type: "interest_state", containerIds: [] }]);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("a timed-out query cannot index late or multiply across session reconnects", async () => {
  const authorization = Promise.withResolvers<string[]>();
  let calls = 0;
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const f = fixture({
    timeoutMs: 5,
    authorize: () => {
      calls++;
      return authorization.promise;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    expect(f.closed).toEqual([1011]);
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      message: "Container authorization timed out",
    });
    const replacement = { ...f.socket };
    await f.gateway.websocket.open(replacement);
    await f.declare("known_containers", [CONTAINER], replacement);
    expect(calls).toBe(1);
    expect(f.closed).toEqual([1011, 1011]);
    authorization.resolve([CONTAINER]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.persisted).toEqual([]);
    expect(
      f.sent.some(
        (message) => Reflect.get(message, "type") === "known_containers_ack",
      ),
    ).toBe(false);
    const recovered = { ...f.socket };
    await f.gateway.websocket.open(recovered);
    await f.declare("known_containers", [CONTAINER], recovered);
    expect(calls).toBe(2);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("repeated relevant access changes have a bounded authorization retry budget", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  let calls = 0;
  const f = fixture({
    authorize: async (_user, ids) => {
      calls++;
      f.publish({ type: "access_changed", containerId: CONTAINER });
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    expect(calls).toBe(3);
    expect(f.closed).toEqual([1011]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.persisted).toEqual([]);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("replacing a subscription replaces its verified ancestry", async () => {
  const formerParent = "00000000-0000-4000-8000-000000000003";
  const paths = { [CONTAINER]: [formerParent, CONTAINER] };
  const f = fixture({ paths, authorize: async (_user, ids) => ids });
  await f.gateway.websocket.open(f.socket);
  await f.declare();
  paths[CONTAINER] = [OTHER, CONTAINER];
  await f.declare("known_containers");
  f.publish({ type: "access_changed", containerId: formerParent });
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  f.publish({ type: "access_changed", containerId: OTHER });
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(
    f.sent.filter(
      (message) => Reflect.get(message, "type") === "resync_required",
    ),
  ).toHaveLength(1);
  f.gateway.stop();
});
