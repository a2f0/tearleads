import { expect, test } from "bun:test";
import { deleteContainer } from "./operations";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

// Row 3 wiring: a successful local deletion may orphan descendant documents,
// so it must re-arm document priming AND nudge the sync lane immediately.
test("local container deletion schedules orphan priming", async () => {
  const parent = {
    container: { id: "root", name: "/", parentId: null, systemSlot: null },
    doc: {},
    record: { documentId: null },
  };
  const leaf = {
    container: { id: "leaf", name: "Leaf", parentId: "root", systemSlot: null },
    doc: {},
    record: { documentId: null },
  };
  const containersById = new Map<string, unknown>([
    ["root", parent],
    ["leaf", leaf],
  ]);
  const state = {
    containersById,
    documentStoresNeedPriming: false,
    listeners: new Set(),
    persistence: {
      deleteContainers: async (
        _execSql: unknown,
        removals: ReadonlyArray<{ containerId: string }>,
      ) => removals.map((removal) => removal.containerId),
    },
    runtime: {
      auth: { isAuthenticated: false },
      infra: { dbStatus: "ready", execSql: async () => [] },
      state: { online: false },
      util: { log: () => undefined },
    },
    snapshot: { nodes: [], ready: true },
  } as unknown as ContainerContentsStoreState;
  let scheduled = 0;
  const syncAgent = {
    scheduleSync: () => {
      scheduled += 1;
    },
  } as unknown as ContainerContentsStoreSyncAgent;

  const deletedNode = await deleteContainer(state, syncAgent, "leaf");

  expect(deletedNode).not.toBeNull();
  expect(state.documentStoresNeedPriming).toBe(true);
  expect(scheduled).toBeGreaterThan(0);
  expect(state.containersById.has("leaf")).toBe(false);
});
