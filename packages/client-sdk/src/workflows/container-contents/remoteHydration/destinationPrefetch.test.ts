import { expect, test } from "bun:test";
import { prefetchDestinationProjections } from "./destinationPrefetch";
import type { RemoteContainerHydrationState } from "./types";

function runtimeFetching(
  fetch: (containerId: string) => Promise<unknown>,
): RemoteContainerHydrationState["runtime"] {
  return {
    apiClient: { getContainerWriterProjection: fetch },
  } as unknown as RemoteContainerHydrationState["runtime"];
}

test("new folder projections are fetched with bounded concurrency", async () => {
  let active = 0;
  let maxActive = 0;
  const fetched: string[] = [];
  const ids = Array.from({ length: 10 }, (_, index) => `folder-${index}`);
  await prefetchDestinationProjections({
    containerIds: ids,
    runtime: runtimeFetching(async (containerId) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(1);
      active -= 1;
      fetched.push(containerId);
      if (containerId === "folder-3") throw new Error("unavailable");
      return null;
    }),
  });
  expect([...fetched].sort()).toEqual([...ids].sort());
  expect(maxActive).toBe(4);
});

test("prefetch stops when the hydration pass is no longer current", async () => {
  let current = true;
  const fetched: string[] = [];
  await prefetchDestinationProjections({
    containerIds: ["a", "b", "c", "d", "e", "f"],
    isCurrent: () => current,
    runtime: runtimeFetching(async (containerId) => {
      fetched.push(containerId);
      current = false;
      return null;
    }),
  });
  expect(fetched.length).toBeLessThanOrEqual(4);
});
