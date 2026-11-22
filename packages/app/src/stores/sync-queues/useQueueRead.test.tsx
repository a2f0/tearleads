import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createQueueReadStore } from "./queueReadStore";
import { useQueueRead } from "./useQueueRead";

afterEach(cleanup);

test("a view whose database closes shows loading, not the rows from before", async () => {
  const store = createQueueReadStore<string, string>({
    coalesceMs: 20,
    read: async () => ["queued write"],
    subscribeToChanges: () => () => undefined,
  });
  const { rerender, result } = renderHook(
    ({ source }: { source: string | null }) => useQueueRead(store, source),
    { initialProps: { source: "db" as string | null } },
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current).toMatchObject({
    items: ["queued write"],
    status: "ready",
  });

  rerender({ source: null });
  expect(result.current.status).toBe("loading");
  // The store keeps its rows for the next view that opens the database.
  expect(store.getSnapshot().status).toBe("ready");
});
