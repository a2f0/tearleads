import { expect, test } from "bun:test";
import {
  db,
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
  containerDocumentSyncTombstones,
  containers,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  blobBudgetOwner,
  prepareBlobUnlink,
} from "../../../test/helpers/blobRewrapBudgetKit";
import { getLatestBlobContentKeyBundle } from "../../access/read/blobContentKeyStore";

async function targetRows(blobId: string) {
  return db
    .select()
    .from(blobContentKeyTargets)
    .where(
      inArray(
        blobContentKeyTargets.blobContentKeyEpochId,
        db
          .select({ id: blobContentKeyEpochs.id })
          .from(blobContentKeyEpochs)
          .where(eq(blobContentKeyEpochs.blobId, blobId)),
      ),
    );
}

async function expectUnlinkState(
  input: Awaited<ReturnType<typeof prepareBlobUnlink>>,
  owner: Awaited<ReturnType<typeof blobBudgetOwner>>,
  committed: boolean,
  before: typeof documents.$inferSelect,
) {
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, input.document.id));
  if (!document) throw new Error("Expected persisted document");
  expect(document.createdAt.toISOString()).toBe(input.document.createdAt);
  expect(document.createdByFingerprint).toBe(before.createdByFingerprint);
  expect(document.attributionIncarnation).toBe(before.attributionIncarnation);
  expect(document.attributionRevision).toBe(before.attributionRevision + 1);
  const touched = await db
    .select()
    .from(containers)
    .where(
      inArray(containers.id, [
        owner.root.kekState.containerId,
        owner.child.containerId,
      ]),
    );
  expect(touched).toHaveLength(2);
  for (const row of touched) expect(row.updatedAt).toEqual(document?.updatedAt);
  const tombstones = await db
    .select()
    .from(containerDocumentSyncTombstones)
    .where(eq(containerDocumentSyncTombstones.documentId, input.document.id));
  expect(tombstones).toEqual([
    expect.objectContaining({
      containerId: owner.child.containerId,
      updatedAt: document?.updatedAt,
    }),
  ]);
  const updates = await db
    .select()
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, input.document.id));
  expect(updates).toHaveLength(committed ? 2 : 0);
  for (const blob of input.blobs) {
    const stored = await getLatestBlobContentKeyBundle(blob.blobId, db);
    expect(stored?.contentKeyEpoch).toBe(1);
    expect(stored?.targets).toEqual([blob.target]);
  }
}

for (const committed of [false, true]) {
  test(`unlink 0/1/3 blob budget with ${committed ? "nonempty frontier and baseline" : "empty frontier without baseline"}`, async () => {
    const owner = await blobBudgetOwner();
    const warm = await prepareBlobUnlink({
      ...owner,
      attachments: 0,
      committed,
    });
    expect((await warm.post("unlink", warm.unlink)).status).toBe(200);
    const sweep = [];
    const linkSweep = [];
    for (const attachments of [0, 1, 3]) {
      const input = await prepareBlobUnlink({
        ...owner,
        attachments,
        committed,
      });
      const retained = await Promise.all(
        input.blobs.map(({ blobId }) => targetRows(blobId)),
      );
      const [before] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, input.document.id));
      if (!before) throw new Error("Expected linked document");
      const counter = { statements: 0 };
      const result = await withDatabaseStatementCounter(counter, () =>
        input.post("unlink", input.unlink),
      );
      expect(result.status).toBe(200);
      expect(result.body.manifestHash).toBe(input.unlink.expectedManifestHash);
      expect(result.body.contentKeyEpoch).toBe(
        input.document.contentKeyEpoch + 1,
      );
      sweep.push(counter.statements);
      linkSweep.push(input.linkStatements);
      await expectUnlinkState(input, owner, committed, before);
      for (const [index, blob] of input.blobs.entries())
        expect(await targetRows(blob.blobId)).toEqual(
          expect.arrayContaining(retained[index] ?? []),
        );
    }
    console.info(
      "blob-unlink-budget-evidence",
      JSON.stringify({ committed, sweep, linkSweep }),
    );
    const transactionStatements =
      getDefaultApiDatabaseKind() === "postgres" ? 2 : 0;
    const baselineStatements = committed ? 4 : 0;
    expect(sweep).toHaveLength(3);
    for (const [index, ceiling] of [46, 58, 64].entries())
      expect(sweep[index]).toBeLessThanOrEqual(
        ceiling + baselineStatements + transactionStatements,
      );
    for (const [index, ceiling] of [45, 57, 63].entries())
      expect(linkSweep[index]).toBeLessThanOrEqual(
        ceiling + transactionStatements,
      );
  });
}
