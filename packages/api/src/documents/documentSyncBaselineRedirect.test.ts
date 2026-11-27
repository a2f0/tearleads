import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportHistorySegments,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
  mergeVersionVectors,
} from "@tearleads/loro";
import { and, asc, eq, inArray } from "drizzle-orm";
import { baselineSegmentRanges } from "../../test/helpers/documentBaselineGroups";
import {
  insertStoredBaselineGroup,
  type StoredBaselineGroupFixture,
} from "../../test/helpers/storedBaselineGroup";
import {
  loadLatestReadableBaselineCoverage,
  resolveBaselineRedirectAfterSequence,
  selectServedSyncUpdates,
} from "./documentSyncBaselineRedirect";
import { insertDocumentUpdateSpans } from "./documentUpdateSpans";
import { listMissingDocumentUpdatePage } from "./documentUpdateStore";

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

test("a rotation baseline's segments converge a fresh reader", async () => {
  const author = await createDocument("rotation-regression-author");
  author.getText("text").update("state before rotation ".repeat(40));
  author.commit();
  const oldEpochUpdate = exportAllUpdates(author);
  const oldEpochVectors = getUpdateVersionVectors(oldEpochUpdate);

  const segments = [
    ...exportHistorySegments(author, { maxBytes: 512, targetBytes: 256 }),
  ];
  expect(segments.length).toBeGreaterThan(1);
  const coverage = mergeVersionVectors(
    segments.map((segment) => segment.partialEndVersionVector),
  );
  expect(coverage).toBe(encodeVersionVector(author));
  const baselineEntries = segments.map((segment) => ({
    bytes: segment.update,
    update: { partialEndVersionVector: segment.partialEndVersionVector },
    writeHeader: { contentKeyEpoch: 2 },
  }));

  const served = selectServedSyncUpdates({
    entries: [
      {
        bytes: oldEpochUpdate,
        update: {
          partialEndVersionVector: oldEpochVectors.partialEndVersionVector,
        },
        writeHeader: { contentKeyEpoch: 1 },
      },
      ...baselineEntries,
    ],
    currentContentKeyEpoch: 2,
    baselineCoverage: coverage,
  });
  expect(served).toEqual(baselineEntries);

  const newcomer = await createDocument("rotation-regression-newcomer");
  importUpdates(
    newcomer,
    served.map((entry) => entry.bytes),
  );
  expect(getTextValue(newcomer)).toBe(getTextValue(author));
});

/** A stored baseline whose segments reach `coverage` together. */
function insertBaselineCheckpoint(input: {
  contentKeyEpoch: number;
  coverage: string;
  documentId: string;
  segments?: number;
}): Promise<StoredBaselineGroupFixture> {
  return insertStoredBaselineGroup({
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    ranges: baselineSegmentRanges(input.coverage, input.segments),
  });
}

test("loadLatestReadableBaselineCoverage returns the latest baseline under the readable epoch", async () => {
  const documentId = randomUUID();
  const { vv1, vv2, vv3 } = await versionVectorTimeline();
  // A pre-rotation baseline under epoch 1 must be ignored for an epoch-2 reader.
  await insertBaselineCheckpoint({
    contentKeyEpoch: 1,
    documentId,
    coverage: vv1,
  });
  // Two current-epoch (epoch 2) baselines; the later sequence must win.
  const { lastSequence: boundedSequence } = await insertBaselineCheckpoint({
    contentKeyEpoch: 2,
    documentId,
    coverage: vv2,
  });
  await insertBaselineCheckpoint({
    contentKeyEpoch: 2,
    documentId,
    coverage: vv3,
  });

  expect(
    await loadLatestReadableBaselineCoverage(db, {
      documentId,
      contentKeyEpoch: 2,
      upperBoundSequence: boundedSequence,
    }),
  ).toBe(vv2);
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

test("pagination redirects past a long covered history to its readable baseline", async () => {
  const documentId = randomUUID();
  const author = await createDocument("baseline-pagination-author");
  const oldUpdates = [];
  for (let index = 0; index < 129; index += 1) {
    const start = encodeVersionVector(author);
    author.getText("text").update(`revision-${index}`);
    const vectors = getUpdateVersionVectors(exportUpdatesSince(author, start));
    oldUpdates.push({
      accessEpoch: 1,
      authorFingerprint: "baseline-pagination-author",
      byteLength: 16,
      dependencyVersionVector: vectors.dependencyVersionVector,
      documentId,
      encryptedData: `encrypted-${index}`,
      id: randomUUID(),
      partialEndVersionVector: vectors.partialEndVersionVector,
      partialStartVersionVector: vectors.partialStartVersionVector,
      plaintextHash: `plaintext-${index}`,
    });
  }
  await db.insert(documentUpdates).values(oldUpdates);
  await insertDocumentUpdateSpans(db, { documentId, updates: oldUpdates });
  const baseline = await insertBaselineCheckpoint({
    contentKeyEpoch: 2,
    coverage: encodeVersionVector(author),
    documentId,
    segments: 5,
  });
  expect(baseline.updateIds).toHaveLength(5);
  const baselineSequence = baseline.lastSequence;

  const afterSequence = await resolveBaselineRedirectAfterSequence({
    afterSequence: 0,
    contentKeyEpoch: 2,
    documentId,
    executor: db,
    firstPage: true,
    localVersionVector: null,
    upperBoundSequence: baselineSequence,
  });
  const page = await listMissingDocumentUpdatePage(db, {
    afterSequence,
    documentId,
    localVersionVector: null,
    maxSerializedBytes: 1_000_000,
    maxUpdates: 64,
    upperBoundSequence: baselineSequence,
  });

  // The page starts just before the group's first segment, and the reader
  // is served the whole group, in index order, and nothing before it.
  expect(afterSequence).toBe(baseline.firstSequence - 1);
  expect(page.updates.map(({ id }) => id)).toEqual([...baseline.updateIds]);
  expect(page.hasMore).toBe(false);

  // A group larger than a page is paged like any run of updates: each page
  // continues where the last one stopped, and the pages hold every segment.
  const paged: string[] = [];
  let after = afterSequence;
  for (;;) {
    const next = await listMissingDocumentUpdatePage(db, {
      afterSequence: after,
      documentId,
      localVersionVector: null,
      maxSerializedBytes: 1_000_000,
      maxUpdates: 2,
      upperBoundSequence: baselineSequence,
    });
    paged.push(...next.updates.map(({ id }) => id));
    if (!next.hasMore) break;
    after = next.lastSequence;
  }
  expect(paged).toEqual([...baseline.updateIds]);
});

// A group is readable only whole. A reader redirected to a group that lost a
// segment, or whose bound cuts it, would skip old-epoch updates for history
// the remaining segments do not carry.
test("a baseline that is not whole cannot enable the redirect", async () => {
  const { vv1, vv3 } = await versionVectorTimeline();
  const coverageOf = (documentId: string, upperBoundSequence?: number) =>
    loadLatestReadableBaselineCoverage(db, {
      contentKeyEpoch: 2,
      documentId,
      upperBoundSequence,
    });
  const wholeGroup = async () => {
    const documentId = randomUUID();
    const group = await insertBaselineCheckpoint({
      contentKeyEpoch: 2,
      coverage: vv3,
      documentId,
      segments: 3,
    });
    expect(group.updateIds).toHaveLength(3);
    expect(await coverageOf(documentId)).toBe(vv3);
    return { documentId, group };
  };
  const segmentId = (group: StoredBaselineGroupFixture, index: number) => {
    const id = group.updateIds[index];
    if (!id) throw new Error(`No segment ${index}`);
    return id;
  };

  // A missing middle segment, first segment, or final segment.
  for (const missing of [1, 0, 2]) {
    const { documentId, group } = await wholeGroup();
    await db
      .delete(documentUpdates)
      .where(eq(documentUpdates.id, segmentId(group, missing)));
    expect(await coverageOf(documentId)).toBeNull();
  }

  // A row whose place in its group was changed after it was committed.
  for (const tampered of [
    { baselineSegmentIndex: 7 },
    { baselineId: randomUUID() },
  ]) {
    const { documentId, group } = await wholeGroup();
    await db
      .update(documentUpdates)
      .set(tampered)
      .where(
        and(
          eq(documentUpdates.documentId, documentId),
          eq(documentUpdates.id, segmentId(group, 1)),
        ),
      );
    expect(await coverageOf(documentId)).toBeNull();
  }

  // A final segment whose count is not its index plus one seals no group:
  // the rows before it are then not all the group claims.
  for (const baselineSegmentCount of [2, 5]) {
    const { documentId, group } = await wholeGroup();
    await db
      .update(documentUpdates)
      .set({ baselineSegmentCount })
      .where(eq(documentUpdates.id, segmentId(group, 2)));
    expect(await coverageOf(documentId)).toBeNull();
  }

  // A group whose stored spans no longer run gapless from zero: what it
  // covers is read by walking them, so it covers nothing to redirect by.
  for (const gap of [{ startCounter: 1 }, { endCounter: 0 }]) {
    const { documentId, group } = await wholeGroup();
    await db
      .update(documentUpdateSpans)
      .set(gap)
      .where(eq(documentUpdateSpans.updateId, segmentId(group, 0)));
    expect(await coverageOf(documentId)).toBeNull();
  }

  // Another update of the document committed inside the group's run: a
  // reader pages a group as one run, so one with a stranger in it is not
  // whole. The group's later segments are stored again after the stranger.
  {
    const { documentId, group } = await wholeGroup();
    const laterIds = [segmentId(group, 1), segmentId(group, 2)];
    const later = await db
      .select()
      .from(documentUpdates)
      .where(inArray(documentUpdates.id, laterIds))
      .orderBy(asc(documentUpdates.sequence));
    await db
      .delete(documentUpdates)
      .where(inArray(documentUpdates.id, laterIds));
    const ordinary = {
      accessEpoch: 1,
      authorFingerprint: "between-segments",
      byteLength: 8,
      dependencyVersionVector: vv1,
      documentId,
      encryptedData: "ordinary",
      partialEndVersionVector: vv1,
      partialStartVersionVector: vv1,
      plaintextHash: "ordinary",
    };
    const restore = later.map(({ sequence: _, ...row }) => row);
    await db.insert(documentUpdates).values(restore);
    expect(await coverageOf(documentId)).toBe(vv3);
    await db
      .delete(documentUpdates)
      .where(inArray(documentUpdates.id, laterIds));
    await db.insert(documentUpdates).values({ ...ordinary, id: randomUUID() });
    await db.insert(documentUpdates).values(restore);
    expect(await coverageOf(documentId)).toBeNull();
  }

  // A pull whose snapshot ends inside the group does not see its seal.
  const { documentId, group } = await wholeGroup();
  expect(await coverageOf(documentId, group.lastSequence - 1)).toBeNull();
  expect(await coverageOf(documentId, group.lastSequence)).toBe(vv3);

  // An earlier whole group still serves when a later one is broken.
  const later = await insertBaselineCheckpoint({
    contentKeyEpoch: 2,
    coverage: vv3,
    documentId,
    segments: 2,
  });
  await db
    .delete(documentUpdates)
    .where(eq(documentUpdates.id, segmentId(later, 0)));
  expect(await coverageOf(documentId)).toBe(vv3);
});

// Every epoch advance normally carries a rotation baseline, but a sync-carried
// content-key bundle can advance the epoch alone. With no current-epoch
// baseline the redirect must be unable to fire — a prior-epoch baseline,
// however valid, must not stand in — so nothing is ever omitted.
test("an epoch advance with no current-epoch baseline serves everything", async () => {
  const documentId = randomUUID();
  const { vv1, vv2 } = await versionVectorTimeline();
  await insertBaselineCheckpoint({
    contentKeyEpoch: 1,
    documentId,
    coverage: vv2,
  });

  const entries = [entry(1, vv1), entry(2, vv2)];
  const baselineCoverage = await loadLatestReadableBaselineCoverage(db, {
    contentKeyEpoch: 2,
    documentId,
  });
  expect(baselineCoverage).toBeNull();
  const served = selectServedSyncUpdates({
    baselineCoverage,
    currentContentKeyEpoch: 2,
    entries,
  });
  expect(served).toEqual(entries);
});

// Two baselines at one epoch with identical coverage, such as a heal whose
// acknowledgement was lost and that ran again, each authenticate under their
// own ids. The duplicate is benign: coverage resolution and the redirect
// behave as if there were one.
test("duplicate baselines with one coverage resolve like a single one", async () => {
  const documentId = randomUUID();
  const { vv1, vv2 } = await versionVectorTimeline();
  await insertBaselineCheckpoint({
    contentKeyEpoch: 2,
    documentId,
    coverage: vv2,
  });
  await insertBaselineCheckpoint({
    contentKeyEpoch: 2,
    documentId,
    coverage: vv2,
  });

  const baselineCoverage = await loadLatestReadableBaselineCoverage(db, {
    documentId,
    contentKeyEpoch: 2,
  });
  expect(baselineCoverage).toBe(vv2);
  const olderEntry = entry(1, vv1);
  const currentEntry = entry(2, vv2);
  expect(
    selectServedSyncUpdates({
      baselineCoverage,
      currentContentKeyEpoch: 2,
      entries: [olderEntry, currentEntry],
    }),
  ).toEqual([currentEntry]);
});
