// The SDK and the API on one rotation baseline of several segments: the
// writer's group passes the API's group rules as signed, and a reader that
// holds nothing rebuilds the document from the group's pages.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import { versionVectorsEqual } from "@tearleads/loro";
import { createTestUser } from "@tearleads/test-utils";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  healWithSegmentedBaseline,
  pullDocumentAsNewInstall,
} from "../../../test/helpers/segmentedBaselineSdk";

test("an SDK heal commits a baseline of several segments, and a cold SDK reader pages through it", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;

  const healed = await healWithSegmentedBaseline({
    containerId: root.kekState.containerId,
    organizationId,
    owner,
  });

  // The API stored the group the SDK signed: one baseline, in index order,
  // sealed by its last segment.
  const segments = await db
    .select({
      baselineId: documentUpdates.baselineId,
      count: documentUpdates.baselineSegmentCount,
      id: documentUpdates.id,
      index: documentUpdates.baselineSegmentIndex,
    })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, healed.documentId),
        isNotNull(documentUpdates.baselineId),
      ),
    )
    .orderBy(asc(documentUpdates.sequence));
  expect(segments.length).toBeGreaterThan(2);
  for (const { id } of segments) {
    expect(healed.committedUpdateIds).not.toContain(id);
  }
  expect(new Set(segments.map(({ baselineId }) => baselineId)).size).toBe(1);
  expect(segments.map(({ index }) => index)).toEqual(
    segments.map((_, position) => position),
  );
  expect(segments.map(({ count }) => count)).toEqual([
    ...segments.slice(1).map(() => null),
    segments.length,
  ]);

  // The segments are counted with the document's other updates.
  const [document] = await db
    .select({ updateCount: documents.updateCount })
    .from(documents)
    .where(eq(documents.id, healed.documentId));
  expect(document?.updateCount).toBe(
    healed.committedUpdateIds.length + segments.length + 1,
  );

  // A reader that holds nothing starts at the group's first segment, never
  // meets the updates it replaces, and pages to the writer's document,
  // wherever a page ends inside the group.
  const segmentIds = segments.map(({ id }) => id);
  for (const maxPageUpdates of [1, 3]) {
    const cold = await pullDocumentAsNewInstall({
      documentId: healed.documentId,
      maxPageUpdates,
      organizationId,
      reader: owner,
    });
    // The baseline also carries the edit written with the heal, so that
    // update is left out of a page sent once the reader holds the group.
    expect<string[]>(cold.servedUpdateIds.slice(0, segmentIds.length)).toEqual(
      segmentIds,
    );
    const afterGroup: string[] = cold.servedUpdateIds.slice(segmentIds.length);
    expect(afterGroup.length).toBeLessThanOrEqual(1);
    expect(afterGroup.every((id) => id === healed.afterBaselineUpdateId)).toBe(
      true,
    );
    expect(cold.pages).toBeGreaterThan(segments.length / maxPageUpdates);
    expect(cold.text).toBe(healed.text);
    expect(cold.historyIdentity).toBe(healed.historyIdentity);
    expect(versionVectorsEqual(cold.version, healed.version)).toBe(true);
  }
}, 120_000);

// The API accepts a heal whose ordinary update comes ahead of its baseline.
// That update is at the group's epoch, so no baseline stands for it and no
// pull is redirected: a new install is served the ordinary history first,
// which carries every operation the baseline does. Its first page ends
// inside the group, and the next is sent with a version that already holds
// the remaining segments, which the API leaves out of a page sent with it.
test("a new install follows a baseline it is not redirected to across a page boundary", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const healed = await healWithSegmentedBaseline({
    containerId: root.kekState.containerId,
    ordinaryUpdateFirst: true,
    organizationId,
    owner,
  });
  const stored = await db
    .select({
      baselineId: documentUpdates.baselineId,
      id: documentUpdates.id,
    })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, healed.documentId))
    .orderBy(asc(documentUpdates.sequence));
  const ahead = [...healed.committedUpdateIds, healed.afterBaselineUpdateId];
  expect(stored.slice(0, ahead.length).map(({ id }) => id)).toEqual(ahead);
  const segmentIds = stored.slice(ahead.length).map(({ id }) => id);
  expect(segmentIds.length).toBeGreaterThan(2);
  expect(stored.slice(ahead.length).every((row) => row.baselineId)).toBe(true);

  const install = await pullDocumentAsNewInstall({
    documentId: healed.documentId,
    // The first page holds the ordinary history and the group's first two
    // segments.
    maxPageUpdates: ahead.length + 2,
    organizationId,
    reader: owner,
  });
  expect(install.servedUpdateIds).toEqual([...ahead, ...segmentIds]);
  expect(install.pages).toBeGreaterThan(1);
  expect(install.text).toBe(healed.text);
  expect(install.historyIdentity).toBe(healed.historyIdentity);
  expect(versionVectorsEqual(install.version, healed.version)).toBe(true);
}, 120_000);
