import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeDocumentContentRecordMetadataHash,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
  importSnapshot,
} from "@tearleads/loro";
import {
  loadLatestReadableBaselineCoverage,
  selectServedSyncUpdateEntries,
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

test("a full-history rotation snapshot converges a fresh reader", async () => {
  const author = await createDocument("rotation-regression-author");
  author.getText("text").update("state before rotation");
  author.commit();
  const oldEpochUpdate = exportAllUpdates(author);
  const oldEpochVectors = getUpdateVersionVectors(oldEpochUpdate);

  const baseline = exportFullHistorySnapshot(author);
  const baselineVectors = getUpdateVersionVectors(baseline);
  const coverage = encodeVersionVector(author);
  const baselineEntry = {
    bytes: baseline,
    update: {
      partialEndVersionVector: baselineVectors.partialEndVersionVector,
    },
    writeHeader: { contentKeyEpoch: 2 },
  };

  const served = selectServedSyncUpdates({
    entries: [
      {
        bytes: oldEpochUpdate,
        update: {
          partialEndVersionVector: oldEpochVectors.partialEndVersionVector,
        },
        writeHeader: { contentKeyEpoch: 1 },
      },
      baselineEntry,
    ],
    currentContentKeyEpoch: 2,
    baselineCoverage: coverage,
  });
  expect(served).toEqual([baselineEntry]);

  const newcomer = await createDocument("rotation-regression-newcomer");
  importSnapshot(newcomer, baselineEntry.bytes);
  expect(getTextValue(newcomer)).toBe("state before rotation");
});

async function insertBaselineCheckpoint(input: {
  baselineUpdateId: string;
  contentKeyEpoch: number;
  corruptMetadataHash?: boolean;
  documentId: string;
  sourceVersionVector: string;
}): Promise<void> {
  const partialStartVersionVector = emptyVersionVector();
  const plaintextHash = `plaintext-${input.baselineUpdateId}`;
  const metadataHash = input.corruptMetadataHash
    ? `tampered-${input.baselineUpdateId}`
    : await computeDocumentContentRecordMetadataHash({
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        documentId: input.documentId,
        partialEndVersionVector: input.sourceVersionVector,
        partialStartVersionVector,
        plaintextHash,
        sourceVersionVector: input.sourceVersionVector,
        updateId: input.baselineUpdateId,
      });
  await db.insert(documentUpdates).values({
    id: input.baselineUpdateId,
    documentId: input.documentId,
    accessEpoch: 1,
    authorFingerprint: "baseline-redirect-test",
    encryptedData: "encrypted-baseline",
    byteLength: 18,
    partialStartVersionVector,
    partialEndVersionVector: input.sourceVersionVector,
    plaintextHash,
  });
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
    header: { metadataHash } as unknown as WriteHeader,
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
  const { vv1, vv2, vv3 } = await versionVectorTimeline();
  // A pre-rotation baseline under epoch 1 must be ignored for an epoch-2 reader.
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 1,
    documentId,
    sourceVersionVector: vv1,
  });
  // Two current-epoch (epoch 2) baselines; the later sequence must win.
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    documentId,
    sourceVersionVector: vv2,
  });
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    documentId,
    sourceVersionVector: vv3,
  });

  expect(
    await loadLatestReadableBaselineCoverage(db, {
      documentId,
      contentKeyEpoch: 2,
    }),
  ).toBe(vv3);
  expect(
    await loadLatestReadableBaselineCoverage(db, {
      documentId,
      contentKeyEpoch: 3,
    }),
  ).toBeNull();
});

// Every epoch advance normally carries a rotate_baseline, but a sync-carried
// content-key bundle can advance the epoch alone. With no current-epoch
// baseline the redirect must be unable to fire — a prior-epoch baseline,
// however valid, must not stand in — so nothing is ever omitted.
test("an epoch advance with no current-epoch baseline serves everything", async () => {
  const documentId = randomUUID();
  const { vv1, vv2 } = await versionVectorTimeline();
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 1,
    documentId,
    sourceVersionVector: vv2,
  });

  const entries = [entry(1, vv1), entry(2, vv2)];
  const served = await selectServedSyncUpdateEntries({
    currentContentKeyEpoch: 2,
    documentId,
    entries,
    executor: db,
  });
  expect(served).toEqual(entries);
});

// The redirect gate is the authenticated v2 checkpoint contract, not row
// presence: a current-epoch checkpoint whose metadata hash does not verify is
// skipped, falling back to an earlier authenticated one — or to serving
// everything when none survives.
test("an unauthenticated current-epoch checkpoint cannot enable the redirect", async () => {
  const documentId = randomUUID();
  const { vv1, vv2, vv3 } = await versionVectorTimeline();
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    corruptMetadataHash: true,
    documentId,
    sourceVersionVector: vv3,
  });

  expect(
    await loadLatestReadableBaselineCoverage(db, {
      documentId,
      contentKeyEpoch: 2,
    }),
  ).toBeNull();
  const entries = [entry(1, vv1), entry(2, vv3)];
  await expect(
    selectServedSyncUpdateEntries({
      currentContentKeyEpoch: 2,
      documentId,
      entries,
      executor: db,
    }),
  ).resolves.toEqual(entries);

  // A valid same-epoch baseline is found by scanning past tampered rows: the
  // newest checkpoint below stays tampered, so returning vv2 requires the
  // loop to skip a failed authentication and keep going rather than stop at
  // the first row.
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    documentId,
    sourceVersionVector: vv2,
  });
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    corruptMetadataHash: true,
    documentId,
    sourceVersionVector: vv3,
  });
  expect(
    await loadLatestReadableBaselineCoverage(db, {
      documentId,
      contentKeyEpoch: 2,
    }),
  ).toBe(vv2);
  // With an authenticated baseline available the redirect now fires
  // end-to-end within the same scenario: vv2 dominates the older entry.
  await expect(
    selectServedSyncUpdateEntries({
      currentContentKeyEpoch: 2,
      documentId,
      entries,
      executor: db,
    }),
  ).resolves.toEqual([entry(2, vv3)]);
});

// A lost-ack re-key of a durable rotate_baseline pending update resubmits the
// same snapshot under a fresh update id, minting a second checkpoint row with
// identical coverage (#1607 L6). Each row authenticates under its own id, so
// the duplicate is benign: coverage resolution and the redirect behave as if
// there were one.
test("duplicate re-keyed baseline checkpoints resolve like a single one", async () => {
  const documentId = randomUUID();
  const { vv1, vv2 } = await versionVectorTimeline();
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    documentId,
    sourceVersionVector: vv2,
  });
  await insertBaselineCheckpoint({
    baselineUpdateId: randomUUID(),
    contentKeyEpoch: 2,
    documentId,
    sourceVersionVector: vv2,
  });

  expect(
    await loadLatestReadableBaselineCoverage(db, {
      documentId,
      contentKeyEpoch: 2,
    }),
  ).toBe(vv2);
  const olderEntry = entry(1, vv1);
  const currentEntry = entry(2, vv2);
  await expect(
    selectServedSyncUpdateEntries({
      currentContentKeyEpoch: 2,
      documentId,
      entries: [olderEntry, currentEntry],
      executor: db,
    }),
  ).resolves.toEqual([currentEntry]);
});
