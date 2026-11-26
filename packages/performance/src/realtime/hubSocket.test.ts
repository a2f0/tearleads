import { expect, spyOn, test } from "bun:test";
import { createRealtimeGateway } from "@tearleads/api/test-runtime";
import { openHubSocket, productionBudgetMs } from "./hubSocket";
import type { InProcessApi } from "./inProcessApi";

const ids: string[] = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];
const proof = (containerId: string) => ({
  containerId,
  pathContainerIds: [],
  principalKeys: [],
});

function fakeApi(
  authorize: InProcessApi["authorizeContainerAccess"],
): InProcessApi {
  return {
    origin: "http://127.0.0.1",
    authorizeContainerAccess: authorize,
    createRealtimeGateway,
    stop: async () => undefined,
  };
}

test("production gives 10 s per 100 ids, from one to six budgets", () => {
  expect(productionBudgetMs(1)).toBe(10_000);
  expect(productionBudgetMs(100)).toBe(10_000);
  expect(productionBudgetMs(101)).toBe(20_000);
  expect(productionBudgetMs(1_000)).toBe(60_000);
  expect(productionBudgetMs(10_000)).toBe(60_000);
});

test("a declaration and the tick re-verify through the gateway", async () => {
  const seen: string[][] = [];
  let readable = new Set(ids);
  const socket = openHubSocket(
    fakeApi(async (userId, requested) => {
      expect(userId).toBe("user");
      seen.push(requested);
      return requested.filter((id) => readable.has(id)).map(proof);
    }),
    "user",
  );
  try {
    const declared = await socket.declare(ids);
    expect(declared.authorized).toBe(3);
    expect(declared.calls).toHaveLength(1);
    expect(socket.snapshotSize().chunks).toBe(1);

    readable = new Set(ids.slice(1));
    const revalidated = await socket.revalidate();
    expect(revalidated).toMatchObject({ authorized: 2, evicted: 1 });
    expect(seen).toEqual([ids, ids]);
    // The pass re-armed the next tick, so the probe can fire it again.
    expect((await socket.revalidate()).authorized).toBe(2);
  } finally {
    socket.close();
  }
});

test("a failed revalidation pass is an error, not a quiet success", async () => {
  // The gateway logs the failure it then swallows.
  const logged = spyOn(console, "error").mockImplementation(() => undefined);
  let fail = false;
  const socket = openHubSocket(
    fakeApi(async (_userId, requested) => {
      if (fail) throw new Error("database unavailable");
      return requested.map(proof);
    }),
    "user",
  );
  try {
    await socket.declare(ids);
    fail = true;
    await expect(socket.revalidate()).rejects.toThrow(/did not complete/);
    expect(logged).toHaveBeenCalled();
  } finally {
    socket.close();
    logged.mockRestore();
  }
});
