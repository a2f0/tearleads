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
  pullDocumentAsColdSdk,
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
  // meets the updates it replaces, and pages to the writer's document.
  const cold = await pullDocumentAsColdSdk({
    documentId: healed.documentId,
    organizationId,
    reader: owner,
  });
  expect(cold.servedUpdateIds).toEqual([
    ...segments.map(({ id }) => id),
    healed.afterBaselineUpdateId,
  ]);
  expect(cold.pages).toBeGreaterThan(segments.length);
  expect(cold.text).toBe(healed.text);
  expect(cold.historyIdentity).toBe(healed.historyIdentity);
  expect(versionVectorsEqual(cold.version, healed.version)).toBe(true);
}, 60_000);
