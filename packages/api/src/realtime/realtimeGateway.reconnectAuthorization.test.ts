import { expect, spyOn, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  OTHER,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as sentry from "../diagnostics/sentry";

test("the first matching declaration reuses fresh reconnect authorization exactly once", async () => {
  let calls = 0;
  const f = fixture({
    cached: [CONTAINER, OTHER],
    authorize: async () => {
      calls++;
      return [CONTAINER];
    },
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [OTHER, CONTAINER]);
  expect(calls).toBe(1);
  expect(f.sent.at(-1)).toMatchObject({ containerIds: [CONTAINER] });
  await f.declare("known_containers", [OTHER, CONTAINER]);
  expect(calls).toBe(2);
  f.gateway.stop();
});

test("an observed revocation invalidates the reconnect handoff", async () => {
  let calls = 0;
  const f = fixture({
    cached: [CONTAINER],
    authorize: async () => (++calls === 1 ? [CONTAINER] : []),
  });
  await f.gateway.websocket.open(f.socket);
  f.publish({ type: "access_changed", containerId: CONTAINER });
  await f.declare("known_containers");
  expect(calls).toBe(2);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  f.gateway.stop();
});

test("a reconnect authorization failure reports an empty baseline and permits recovery", async () => {
  const failure = new Error("Unavailable authorization database");
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  let calls = 0;
  const f = fixture({
    cached: [CONTAINER],
    authorize: async () => {
      if (++calls === 1) throw failure;
      return [CONTAINER];
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    expect(f.closed).toEqual([]);
    expect(f.sent).toEqual([{ type: "interest_state", containerIds: [] }]);
    expect(capture).toHaveBeenCalledWith(
      failure,
      "background-error",
      "websocket.hydrate",
    );
    await f.declare("known_containers");
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

for (const source of ["cache", "authorization"] as const) {
  test(
    "a timed-out reconnect " +
      source +
      " keeps an empty live socket and cannot install late",
    async () => {
      const pending = Promise.withResolvers<string[]>();
      const capture = spyOn(sentry, "captureApiError").mockImplementation(
        () => undefined,
      );
      const f = fixture({
        cached: [CONTAINER],
        timeoutMs: 5,
        ...(source === "cache" ? { load: () => pending.promise } : {}),
        authorize: async () =>
          source === "authorization" ? pending.promise : [CONTAINER],
      });
      try {
        await f.gateway.websocket.open(f.socket);
        expect(f.closed).toEqual([]);
        expect(f.sent).toEqual([{ type: "interest_state", containerIds: [] }]);
        expect(capture).toHaveBeenCalledTimes(1);
        pending.resolve([CONTAINER]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
        await f.declare("known_containers");
        expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
      } finally {
        pending.resolve([]);
        capture.mockRestore();
        f.gateway.stop();
      }
    },
  );
}

test("an unrelated tenant event preserves the first reconnect proof handoff", async () => {
  let calls = 0;
  const f = fixture({
    cached: [CONTAINER],
    authorize: async () => {
      calls++;
      return [CONTAINER];
    },
  });
  await f.gateway.websocket.open(f.socket);
  f.publish({ type: "access_changed", containerId: OTHER });
  await f.declare("known_containers");
  expect(calls).toBe(1);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  f.gateway.stop();
});

test("large declarations receive a proportional signed-verification budget", async () => {
  const ids = Array.from({ length: 1000 }, () => crypto.randomUUID());
  const f = fixture({
    timeoutMs: 50,
    authorize: async (_user, requested) => {
      await new Promise((resolve) => setTimeout(resolve, 75));
      return requested;
    },
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", ids);
  expect(f.closed).toEqual([]);
  expect(f.sent.at(-1)).toMatchObject({ containerIds: ids });
  expect(f.router.interestedSocketCount(ids[0] ?? "")).toBe(1);
  f.gateway.stop();
});
