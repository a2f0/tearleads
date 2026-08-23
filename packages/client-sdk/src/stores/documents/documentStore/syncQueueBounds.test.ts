import { expect, test } from "bun:test";
import { createPendingUpdateRecord } from "../../../../test/helpers/documentFixtures";
import { selectDocumentStoreSyncQueues } from "./sync";

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

  const selected = selectDocumentStoreSyncQueues([
    ...ordinaryUpdates,
    tailCheckpoint,
  ]);

  expect(selected.preRegisteredUpdates).toHaveLength(64);
  expect(selected.preRegisteredUpdates).not.toContain(tailCheckpoint);
  expect(selected.planningUpdates).toHaveLength(65);
  expect(selected.planningUpdates.at(-1)).toBe(tailCheckpoint);
});
