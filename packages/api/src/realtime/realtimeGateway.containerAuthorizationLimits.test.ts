import { expect, spyOn, test } from "bun:test";
import { MAX_WS_INTEREST_CONTAINER_IDS } from "@tearleads/validators/realtime";
import {
  CONTAINER,
  fixture,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as sentry from "../diagnostics/sentry";

test("completed declarations release capacity for later updates", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  f.gateway.websocket.open(f.socket);
  for (let i = 0; i < 40; i++) await f.declare();
  expect(f.closed).toEqual([]);
  expect(
    f.sent.filter(
      (frame) => Reflect.get(frame, "type") === "known_containers_ack",
    ),
  ).toHaveLength(40);
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
        : Array.from({ length: MAX_WS_INTEREST_CONTAINER_IDS }, () =>
            crypto.randomUUID(),
          );
    f.gateway.websocket.open(f.socket);
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
    expect(f.sent).toEqual([]);
  });
}

test("the largest declaration has a capped authorization deadline", async () => {
  const pending = Promise.withResolvers<string[]>();
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const f = fixture({ timeoutMs: 2, authorize: () => pending.promise });
  const ids = Array.from({ length: MAX_WS_INTEREST_CONTAINER_IDS }, () =>
    crypto.randomUUID(),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  f.gateway.websocket.open(f.socket);
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
});

test("installed roots per socket are capped at MAX_WS_INTEREST_CONTAINER_IDS across add frames", async () => {
  const authorizedBatches: string[][] = [];
  const f = fixture({
    authorize: async (_user, ids) => {
      authorizedBatches.push([...ids]);
      return ids;
    },
  });
  const roots = Array.from({ length: MAX_WS_INTEREST_CONTAINER_IDS }, () =>
    crypto.randomUUID(),
  );
  const extraA = crypto.randomUUID();
  const extraB = crypto.randomUUID();
  f.gateway.websocket.open(f.socket);

  await f.declare("known_containers", roots);
  expect(f.router.interestOf(f.socket)).toHaveLength(
    MAX_WS_INTEREST_CONTAINER_IDS,
  );

  const firstRoot = roots[0];
  if (!firstRoot) throw new Error("Expected first root id");
  // Adding an already-held root alongside two excess roots refreshes only the
  // existing root and refuses the two excess roots without querying them.
  f.sent.length = 0;
  authorizedBatches.length = 0;
  await f.declare("known_containers.add", [firstRoot, extraA, extraB]);
  expect(authorizedBatches).toEqual([[firstRoot]]);
  expect(f.router.interestOf(f.socket)).toHaveLength(
    MAX_WS_INTEREST_CONTAINER_IDS,
  );
  expect(f.router.interestedSocketCount(extraA)).toBe(0);
  expect(f.router.interestedSocketCount(extraB)).toBe(0);
  expect(f.sent.at(-1)).toMatchObject({
    containerIds: [firstRoot],
    type: "known_containers_ack",
  });

  // Removing one root frees one slot; the next add admits only the first extra root.
  await f.declare("known_containers.remove", [firstRoot]);
  f.sent.length = 0;
  authorizedBatches.length = 0;
  await f.declare("known_containers.add", [extraA, extraB]);
  expect(authorizedBatches).toEqual([[extraA]]);
  expect(f.router.interestedSocketCount(extraA)).toBe(1);
  expect(f.router.interestedSocketCount(extraB)).toBe(0);
  expect(f.sent.at(-1)).toMatchObject({
    containerIds: [extraA],
    type: "known_containers_ack",
  });
  f.gateway.stop();
});
