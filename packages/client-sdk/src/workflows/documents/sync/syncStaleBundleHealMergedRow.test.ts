import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesInVersionRange,
  exportUpdatesSince,
  satisfiesVersionVector,
} from "@tearleads/loro";
import { createStaleBundleSyncFixture } from "../../../../test/helpers/staleBundleSyncFixture";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { planQueuedUpdateMerge } from "../../../stores/documents/documentStore/sync/syncQueueMergePlan";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

test("a stale-bundle heal carries a merged queued row after its baseline", async () => {
  const fixture = await createStaleBundleSyncFixture();
  const doc = await createDocument("stale-heal-merged-writer");
  const rows = ["a", "ab", "abc"].map((text) => {
    const before = encodeVersionVector(doc);
    doc.getText("text").update(text);
    doc.commit();
    const fields = createPendingUpdateFields(exportUpdatesSince(doc, before));
    if (!fields) throw new Error("expected an update");
    return { id: crypto.randomUUID(), origin: "local" as const, ...fields };
  });
  const [group] = planQueuedUpdateMerge({ doc, rows });
  if (!group) throw new Error("expected a merge group");
  const blob = exportUpdatesInVersionRange(
    doc,
    group.partialStartVersionVector,
    group.partialEndVersionVector,
  );
  const fields = blob ? createPendingUpdateFields(blob) : null;
  if (!fields) throw new Error("expected merged fields");
  const merged = { id: crypto.randomUUID(), ...fields };

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(doc),
    localVersionVector: null,
    pendingUpdates: [merged],
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  expect(materialized.healedStaleContentKeyBundle).toBe(true);
  const { outgoingUpdates } = materialized.plan.request;
  expect(
    outgoingUpdates.map((update) => update.checkpointKind ?? null),
  ).toEqual(["rotate_baseline", null]);
  expect(outgoingUpdates[1]?.id).toBe(merged.id);
  expect(outgoingUpdates[1]?.partialEndVersionVector).toBe(
    merged.partialEndVersionVector,
  );
  // The baseline covers every operation the merged row carries.
  expect(
    satisfiesVersionVector(
      outgoingUpdates[0]?.partialEndVersionVector,
      merged.partialEndVersionVector,
    ),
  ).toBe(true);
});
