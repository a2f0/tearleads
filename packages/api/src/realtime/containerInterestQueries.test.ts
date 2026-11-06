import { expect, test } from "bun:test";
import { ContainerInterestQueries } from "./containerInterestQueries";
import type { VerifiedContainerInterest } from "./containerInterestTypes";
import type { WsConnection } from "./wsConnection";

const CONTAINER = "00000000-0000-4000-8000-000000000001";
const ws = {
  data: { userId: "user", sessionId: "session" },
} as unknown as WsConnection;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function proofsFor(ids: string[]): VerifiedContainerInterest[] {
  return ids.map((containerId) => ({
    containerId,
    pathContainerIds: [containerId],
    principalKeys: [],
  }));
}

test("a reconnect marks running queries stale so later runs re-query", async () => {
  const held = Promise.withResolvers<void>();
  let calls = 0;
  const queries = new ContainerInterestQueries(async (_user, ids) => {
    if (++calls === 1) await held.promise;
    return proofsFor(ids);
  }, 1_000);
  const installed: string[] = [];
  const first = queries.run(
    ws,
    [CONTAINER],
    () => true,
    () => {
      installed.push("first");
    },
  );
  await flush();
  queries.markAllStale();
  const second = queries.run(
    ws,
    [CONTAINER],
    () => true,
    () => {
      installed.push("second");
    },
  );
  await flush();
  // The second run awaits the stale query instead of sharing it.
  expect(calls).toBe(1);
  expect(installed).toEqual([]);
  held.resolve();
  await Promise.all([first, second]);
  expect(calls).toBe(2);
  expect(installed).toEqual(["first", "second"]);
});

test("a declaration after an overflow awaits the query and re-queries", async () => {
  const held = Promise.withResolvers<void>();
  let calls = 0;
  const queries = new ContainerInterestQueries(async (_user, ids) => {
    if (++calls === 1) await held.promise;
    return proofsFor(ids);
  }, 1_000);
  const installed: string[] = [];
  const first = queries.run(
    ws,
    [CONTAINER],
    () => true,
    () => {
      installed.push("first");
    },
  );
  await flush();
  // One past the 10,000-change observation cap overflows the running query.
  for (let index = 0; index <= 10_000; index++)
    queries.invalidate(`unrelated-${index}`);
  const second = queries.run(
    ws,
    [CONTAINER],
    () => true,
    () => {
      installed.push("second");
    },
  );
  await flush();
  // The second run awaits the overflowed query instead of sharing it.
  expect(calls).toBe(1);
  held.resolve();
  // The reader that saw the flood is still refused.
  await expect(first).rejects.toThrow(
    "Too many pending container access changes",
  );
  await second;
  expect(calls).toBe(2);
  expect(installed).toEqual(["second"]);
});

test("a timed-out query is awaited but never reused by a later run", async () => {
  const held = Promise.withResolvers<void>();
  let calls = 0;
  const queries = new ContainerInterestQueries(async (_user, ids) => {
    if (++calls === 1) await held.promise;
    return proofsFor(ids);
  }, 5);
  const installed: string[] = [];
  await expect(
    queries.run(
      ws,
      [CONTAINER],
      () => true,
      () => {
        installed.push("first");
      },
    ),
  ).rejects.toThrow("Container authorization timed out");
  expect(calls).toBe(1);
  const second = queries.run(
    ws,
    [CONTAINER],
    () => true,
    () => {
      installed.push("second");
    },
  );
  held.resolve();
  await second;
  expect(calls).toBe(2);
  expect(installed).toEqual(["second"]);
});
