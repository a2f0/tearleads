import { expect, test } from "bun:test";
import { createPendingUpdateRecord } from "../../../../test/helpers/documentFixtures";
import type { DocumentStoreState } from "./state";
import {
  prepareDocumentStoreSyncQueue,
  preRegisterMaterializedDocumentSyncUpdateIds,
} from "./sync";

test("store sync keeps a tail checkpoint visible to stale-heal planning", () => {
  const ordinaryUpdates = Array.from({ length: 64 }, (_, index) =>
    createPendingUpdateRecord({
      id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
    }),
  );
  const tailCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440999",
    sourceVersionVector: "{}",
  });

  const selected = prepareDocumentStoreSyncQueue([
    ...ordinaryUpdates,
    tailCheckpoint,
  ]);

  expect(selected.planningUpdates).toHaveLength(65);
  expect(selected.planningUpdates.at(-1)).toBe(tailCheckpoint);
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
