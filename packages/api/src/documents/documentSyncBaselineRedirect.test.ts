import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
} from "@tearleads/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type WriteHeader,
} from "@tearleads/crypto";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import {
  loadLatestReadableBaselineCoverage,
  selectServedSyncUpdates,
} from "./documentSyncBaselineRedirect";

function entry(contentKeyEpoch: number, partialEndVersionVector: string) {
  return {
    update: { partialEndVersionVector },
    writeHeader: { contentKeyEpoch },
  };
}

// Three monotonically-increasing version vectors (vv1 < vv2 < vv3) to exercise
// the domination gate.
async function versionVectorTimeline() {
  const doc = await createDocument("baseline-redirect-seed");
  doc.getText("text").update("one");
  const vv1 = encodeVersionVector(doc);
  doc.getText("text").update("one two");
  const vv2 = encodeVersionVector(doc);
  doc.getText("text").update("one two three");
  const vv3 = encodeVersionVector(doc);
  return { vv1, vv2, vv3 };
}

test("serves everything unchanged when no older-epoch update is present", async () => {
  const { vv1, vv2 } = await versionVectorTimeline();
  const served = selectServedSyncUpdates({
    entries: [entry(2, vv1), entry(2, vv2)],
    currentContentKeyEpoch: 2,
    baselineCoverage: vv2,
  });
  expect(served).toHaveLength(2);
});

test("serves everything when an older epoch is present but no readable baseline exists", async () => {
  const { vv1, vv2 } = await versionVectorTimeline();
  const served = selectServedSyncUpdates({
    entries: [entry(1, vv1), entry(2, vv2)],
    currentContentKeyEpoch: 2,
    baselineCoverage: null,
  });
  expect(served).toHaveLength(2);
});

test("drops older-epoch updates the current-epoch baseline dominates", async () => {
  const { vv1, vv2 } = await versionVectorTimeline();
  const olderEntry = entry(1, vv1);
  const currentEntry = entry(2, vv2);
  // baseline coverage vv2 fully covers the older update whose end is vv1.
  const served = selectServedSyncUpdates({
    entries: [olderEntry, currentEntry],
    currentContentKeyEpoch: 2,
    baselineCoverage: vv2,
  });
  expect(served).toEqual([currentEntry]);
});

test("falls back to serving everything when the baseline does not dominate an older update", async () => {
  const { vv2, vv3 } = await versionVectorTimeline();
  // The older update's end (vv3) is NOT covered by the baseline (vv2) — e.g. a
  // concurrent pre-rotation write the baseline author had not yet seen.
  const served = selectServedSyncUpdates({
    entries: [entry(1, vv3), entry(2, vv2)],
    currentContentKeyEpoch: 2,
    baselineCoverage: vv2,
  });
  expect(served).toHaveLength(2);
});

async function insertBaselineCheckpoint(input: {
  baselineUpdateId: string;
  contentKeyEpoch: number;
  documentId: string;
  sourceVersionVector: string;
}): Promise<void> {
  await db.insert(documentContentWriteHeaders).values({
    updateId: input.baselineUpdateId,
    documentId: input.documentId,
    organizationId: randomUUID(),
    contentKeyEpoch: input.contentKeyEpoch,
    accessManifestHash: `manifest-${input.baselineUpdateId}`,
    targetHash: `target-${input.baselineUpdateId}`,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.baselineUpdateId,
    nonceDomainHash: `nonce-${input.baselineUpdateId}`,
    headerHash: `header-${input.baselineUpdateId}`,
    header: {} as unknown as WriteHeader,
  });
  await db.insert(documentAuditCheckpoints).values({
    documentId: input.documentId,
    baselineUpdateId: input.baselineUpdateId,
    checkpointKind: "rotate_baseline",
    sourceVersionVector: input.sourceVersionVector,
    checkpointHash: `checkpoint-${input.baselineUpdateId}`,
    accessEpoch: 1,
    accessManifestHash: `checkpoint-manifest-${input.baselineUpdateId}`,
    actorUserId: randomUUID(),
    actorFingerprint: "baseline-redirect-test",
  });
}

test("loadLatestReadableBaselineCoverage returns the latest baseline under the readable epoch", async () => {
  const documentId = randomUUID();
  // A pre-rotation baseline under epoch 1 must be ignored for an epoch-2 reader.
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 1,
    documentId,
    sourceVersionVector: "old-epoch-coverage",
  });
  // Two current-epoch (epoch 2) baselines; the later sequence must win.
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    documentId,
    sourceVersionVector: "earlier-current-coverage",
  });
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    documentId,
    sourceVersionVector: "latest-current-coverage",
  });

  expect(
    await loadLatestReadableBaselineCoverage(db, {
      documentId,
      contentKeyEpoch: 2,
    }),
  ).toBe("latest-current-coverage");
  expect(
    await loadLatestReadableBaselineCoverage(db, {
      documentId,
      contentKeyEpoch: 3,
    }),
  ).toBeNull();
});
