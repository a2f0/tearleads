import { expect, spyOn, test } from "bun:test";
import {
  CONTAINER,
  fixture,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as sentry from "../diagnostics/sentry";

test("completed declarations release capacity for later updates", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  await f.gateway.websocket.open(f.socket);
  for (let i = 0; i < 40; i++) await f.declare();
  expect(f.closed).toEqual([]);
  expect(f.persisted).toHaveLength(40);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  f.gateway.stop();
});

for (const flood of ["declarations", "retained IDs"] as const) {
  test(`pending authorization bounds ${flood} and discards late work`, async () => {
    const pending = Promise.withResolvers<string[]>();
    let calls = 0;
    const f = fixture({
      authorize: () => {
        calls++;
        return pending.promise;
      },
    });
    const ids =
      flood === "declarations"
        ? [CONTAINER]
        : Array.from({ length: 10_000 }, () => crypto.randomUUID());
    await f.gateway.websocket.open(f.socket);
    const first = f.declare("known_containers", ids);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const queued = Array.from(
      { length: flood === "declarations" ? 100 : 3 },
      () => f.declare("known_containers.add", ids),
    );
    try {
      expect(f.closed).toEqual([1013]);
      expect(calls).toBe(1);
    } finally {
      pending.resolve(ids);
      await Promise.all([first, ...queued]);
      f.gateway.stop();
    }
    expect(calls).toBe(1);
    expect(f.router.interestedSocketCount(ids[0] ?? "")).toBe(0);
    expect(f.persisted).toEqual([]);
    expect(f.sent).toEqual([{ type: "interest_state", containerIds: [] }]);
  });
}

test("the largest declaration has a capped authorization deadline", async () => {
  const pending = Promise.withResolvers<string[]>();
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const f = fixture({ timeoutMs: 2, authorize: () => pending.promise });
  const ids = Array.from({ length: 10_000 }, () => crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  await f.gateway.websocket.open(f.socket);
  const declaration = f.declare("known_containers", ids);
  try {
    expect(
      await Promise.race([
        declaration.then(() => "processed"),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("still waiting"), 100);
        }),
      ]),
    ).toBe("processed");
    expect(f.closed).toEqual([1011]);
  } finally {
    clearTimeout(timer);
    pending.resolve(ids);
    await declaration;
    capture.mockRestore();
    f.gateway.stop();
  }
  expect(f.router.interestedSocketCount(ids[0] ?? "")).toBe(0);
  expect(f.persisted).toEqual([]);
});
