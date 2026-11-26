import { expect, test } from "bun:test";
import { createPendingUpdateRecord } from "../../../../../test/helpers/data/documentFixtures";
import type { DocumentStoreState } from "../state";
import { preRegisterMaterializedDocumentSyncUpdateIds } from "./syncAcceptedUpdateIds";
import { prepareDocumentStoreSyncQueue } from "./syncDocumentState";

test("store sync keeps a queue past one batch visible to planning", () => {
  const firstBatch = Array.from({ length: 64 }, (_, index) =>
    createPendingUpdateRecord({
      id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
    }),
  );
  const tailUpdate = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440999",
  });

  const selected = prepareDocumentStoreSyncQueue([...firstBatch, tailUpdate]);

  expect(selected.planningUpdates).toHaveLength(65);
  expect(selected.planningUpdates.at(-1)).toBe(tailUpdate);
  expect(selected.queuedUpdateCount).toBe(65);
});

test("store sync pre-registers the exact materialized batches once", () => {
  const state = {
    locallyAcceptedUpdateIds: new Set<string>(),
  } as DocumentStoreState;
  const registeredUpdateIds: string[] = [];

  preRegisterMaterializedDocumentSyncUpdateIds(state, registeredUpdateIds, [
    "synthetic-baseline",
    "later-ordinary",
  ]);
  preRegisterMaterializedDocumentSyncUpdateIds(state, registeredUpdateIds, [
    "later-ordinary",
  ]);

  expect(registeredUpdateIds).toEqual(["synthetic-baseline", "later-ordinary"]);
  expect([...state.locallyAcceptedUpdateIds]).toEqual(registeredUpdateIds);
});
