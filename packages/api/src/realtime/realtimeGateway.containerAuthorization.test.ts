import { expect, spyOn, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  OTHER,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as sentry from "../diagnostics/sentry";

test("denied declarations acknowledge processing without indexing inaccessible ids", async () => {
  const calls: string[][] = [];
  const f = fixture({
    authorize: async (_user, ids) => {
      calls.push(ids);
      return [];
    },
  });
  f.gateway.websocket.open(f.socket);
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
    containerIds: [],
  });
  f.gateway.stop();
});

test("a socket receives no container hint before its own declaration", async () => {
  const calls: string[][] = [];
  const f = fixture({
    authorize: async (_user, ids) => {
      calls.push(ids);
      return ids;
    },
  });
  f.gateway.websocket.open(f.socket);
  const hint = {
    type: "document_update_created",
    containerIds: [CONTAINER],
    documentId: "document",
    updateIds: ["update"],
  };
  f.publish(hint);
  f.publish({
    type: "container_mutation_created",
    containerId: CONTAINER,
    eventType: "container.move",
    parentId: OTHER,
    previousParentId: null,
    updatedAt: "2026-09-13T00:00:00.000Z",
  });
  // Opening authorizes nothing and sends nothing: interest starts empty and
  // only the client's declaration fills it.
  expect(calls).toEqual([]);
  expect(f.sent).toEqual([]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  await f.declare("known_containers");
  expect(calls).toEqual([[CONTAINER]]);
  f.publish(hint);
  expect(f.sent.at(-1)).toMatchObject({
    type: "document_update_created",
    containerIds: [CONTAINER],
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
  f.gateway.websocket.open(f.socket);
  const pending = f.declare();
  await started.promise;
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  f.gateway.websocket.close(f.socket);
  authorization.resolve([CONTAINER]);
  await pending;
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.sent).toEqual([]);
  f.gateway.stop();
});

test("a later remove wins over an in-flight add", async () => {
  const authorization = Promise.withResolvers<string[]>();
  const f = fixture({ authorize: () => authorization.promise });
  f.gateway.websocket.open(f.socket);
  const adding = f.declare();
  const removing = f.declare("known_containers.remove");
  authorization.resolve([CONTAINER]);
  await Promise.all([adding, removing]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
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
  f.gateway.websocket.open(f.socket);
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
    containerIds: [],
  });
  f.gateway.stop();
});

test("an unrelated access change preserves authorized interest", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  f.gateway.websocket.open(f.socket);
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
  f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER, OTHER]);
  expect(f.closed).toEqual([]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  expect(f.sent.at(-1)).toEqual({
    type: "known_containers_ack",
    declarationId: "declaration",
    containerIds: [OTHER],
  });
  await f.declare("known_containers.remove", [CONTAINER]);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  f.gateway.stop();
});

test("ancestor eviction reaches descendants and does not affect an unrelated tenant", async () => {
  const f = fixture({
    paths: { [CONTAINER]: [OTHER, CONTAINER] },
    authorize: async (_user, ids) => ids,
  });
  f.gateway.websocket.open(f.socket);
  await f.declare();
  const unrelatedId = "00000000-0000-4000-8000-000000000003";
  const unrelated = {
    ...f.socket,
    data: { userId: "unrelated", sessionId: "unrelated" },
  };
  f.gateway.websocket.open(unrelated);
  await f.declare("known_containers", [unrelatedId], unrelated);
  f.publish({ type: "access_changed", containerId: OTHER });
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(unrelatedId)).toBe(1);
  expect(
    f.sent.filter(
      (message) => Reflect.get(message, "type") === "resync_required",
    ),
  ).toEqual([{ type: "resync_required", containerIds: [CONTAINER] }]);
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
  f.gateway.websocket.open(f.socket);
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
    f.gateway.websocket.open(f.socket);
    await f.declare();
    expect(capture).toHaveBeenCalledWith(
      failure,
      "background-error",
      "websocket.operation",
    );
    expect(f.closed).toEqual([1011]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.sent).toEqual([]);
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
    f.gateway.websocket.open(f.socket);
    await f.declare();
    expect(f.closed).toEqual([1011]);
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      message: "Container authorization timed out",
    });
    const replacement = { ...f.socket };
    f.gateway.websocket.open(replacement);
    await f.declare("known_containers", [CONTAINER], replacement);
    expect(calls).toBe(1);
    expect(f.closed).toEqual([1011, 1011]);
    authorization.resolve([CONTAINER]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(
      f.sent.some(
        (message) => Reflect.get(message, "type") === "known_containers_ack",
      ),
    ).toBe(false);
    const recovered = { ...f.socket };
    f.gateway.websocket.open(recovered);
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
    f.gateway.websocket.open(f.socket);
    await f.declare();
    expect(calls).toBe(3);
    expect(f.closed).toEqual([1011]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("replacing a subscription replaces its verified ancestry", async () => {
  const formerParent = "00000000-0000-4000-8000-000000000003";
  const paths = { [CONTAINER]: [formerParent, CONTAINER] };
  const f = fixture({ paths, authorize: async (_user, ids) => ids });
  f.gateway.websocket.open(f.socket);
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

test("two tabs sharing a session share identical pending authorization", async () => {
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
  const second = { ...f.socket };
  await Promise.all([
    f.gateway.websocket.open(f.socket),
    f.gateway.websocket.open(second),
  ]);
  const firstPending = f.declare();
  const secondPending = f.declare("known_containers", [CONTAINER], second);
  await started.promise;
  authorization.resolve([CONTAINER]);
  await Promise.all([firstPending, secondPending]);
  expect(f.closed).toEqual([]);
  expect(calls).toBe(1);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(2);
  f.gateway.stop();
});

test("tabs with different declarations wait without closing the shared session", async () => {
  const started = Promise.withResolvers<void>();
  const authorization = Promise.withResolvers<string[]>();
  const calls: string[][] = [];
  const f = fixture({
    authorize: (_user, ids) => {
      calls.push(ids);
      started.resolve();
      return calls.length === 1 ? authorization.promise : Promise.resolve(ids);
    },
  });
  const second = { ...f.socket };
  await Promise.all([
    f.gateway.websocket.open(f.socket),
    f.gateway.websocket.open(second),
  ]);
  const firstPending = f.declare();
  await started.promise;
  const secondPending = f.declare("known_containers", [OTHER], second);
  authorization.resolve([CONTAINER]);
  await Promise.all([firstPending, secondPending]);
  expect(f.closed).toEqual([]);
  expect(calls).toEqual([[CONTAINER], [OTHER]]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  f.gateway.stop();
});

test("an observed grant retries a denied query before acknowledging", async () => {
  const started = Promise.withResolvers<void>();
  const authorization = Promise.withResolvers<string[]>();
  let calls = 0;
  const f = fixture({
    authorize: (_user, ids) => {
      started.resolve();
      return ++calls === 1 ? authorization.promise : Promise.resolve(ids);
    },
  });
  f.gateway.websocket.open(f.socket);
  const pending = f.declare();
  await started.promise;
  f.publish({ type: "access_changed", containerId: CONTAINER });
  authorization.resolve([]);
  await pending;
  expect(calls).toBe(2);
  expect(f.closed).toEqual([]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  f.gateway.stop();
});

test("shared query invalidation lets both tabs retry with one fresh query", async () => {
  const started = Promise.withResolvers<void>();
  const authorization = Promise.withResolvers<string[]>();
  let calls = 0;
  const f = fixture({
    authorize: (_user, ids) => {
      started.resolve();
      return ++calls === 1 ? authorization.promise : Promise.resolve(ids);
    },
  });
  const second = { ...f.socket };
  await Promise.all([
    f.gateway.websocket.open(f.socket),
    f.gateway.websocket.open(second),
  ]);
  const firstPending = f.declare();
  const secondPending = f.declare("known_containers", [CONTAINER], second);
  await started.promise;
  f.publish({ type: "access_changed", containerId: CONTAINER });
  authorization.resolve([CONTAINER]);
  await Promise.all([firstPending, secondPending]);
  expect(calls).toBe(2);
  expect(f.closed).toEqual([]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(2);
  f.gateway.stop();
});

test("the router indexes only IDs carried by verified proofs", async () => {
  const f = fixture({ authorize: async () => [] });
  f.gateway.websocket.open(f.socket);
  f.router.applyAuthorizedContainerInterest(
    f.socket,
    { kind: "add", containerIds: [CONTAINER] },
    [],
  );
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  f.publish({ type: "access_changed", containerId: CONTAINER });
  expect(f.sent).toEqual([]);
  f.gateway.stop();
});

test("unrelated changes do not retry a denied declaration", async () => {
  let calls = 0;
  const f = fixture({
    authorize: async () => {
      calls++;
      f.publish({ type: "access_changed", containerId: OTHER });
      return [];
    },
  });
  f.gateway.websocket.open(f.socket);
  await f.declare();
  expect(calls).toBe(1);
  expect(f.closed).toEqual([]);
  expect(f.sent.at(-1)).toEqual({
    type: "known_containers_ack",
    declarationId: "declaration",
    containerIds: [],
  });
  f.gateway.stop();
});

test("a fresh denied re-add evicts an earlier subscription after a missed hint", async () => {
  let readable = true;
  const f = fixture({ authorize: async (_user, ids) => (readable ? ids : []) });
  f.gateway.websocket.open(f.socket);
  await f.declare();
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  readable = false;
  await f.declare();
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.sent.at(-1)).toMatchObject({ containerIds: [] });
  f.gateway.stop();
});
