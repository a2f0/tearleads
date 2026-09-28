import { expect, test } from "bun:test";
import {
  computeAccessManifestHash,
  type DocumentLinkSetManifestState,
  deriveDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../workflows/documents/purge";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { verifyDocumentWriterProjection } from "./documentProjectionVerification";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";

test("an empty purge history cannot replace a pinned document with an unrelated writer's snapshot", async () => {
  const owner = await createMaterializedSyncFixture({
    containerId: "owner-container",
    userId: "owner",
  });
  const attacker = await createMaterializedSyncFixture({
    containerId: "attacker-container",
    documentId: owner.writerProjection.documentId,
    organizationId: owner.author.organizationId,
    userId: "attacker",
  });
  const original = owner.writerProjection.documentManifest;
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: owner.writerProjection.documentId,
    organizationId: owner.author.organizationId,
    epoch: 2,
    previousManifestHash: original.manifestHash,
    eventHash: attacker.writerProjection.documentManifest.event.eventHash,
    linkedContainerIds: [attacker.projection.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const forgedProjection = {
    ...attacker.writerProjection,
    documentManifest: {
      event: attacker.writerProjection.documentManifest.event,
      manifest: { ...manifest },
      manifestHash: await computeAccessManifestHash(manifest),
      state: { ...state },
    },
  };
  const proof = await createDocumentPurgeProof(
    attacker.author,
    forgedProjection,
  );
  const database = await createTestExecSql("purge-unpinned-snapshot");
  const resolveUserKey = async (userId: string) =>
    userId === owner.author.signerUserId
      ? owner.resolveProjectionUserKey(userId)
      : attacker.resolveProjectionUserKey(userId);
  try {
    await verifyDocumentWriterProjection({
      execSql: database.execSql,
      projection: owner.writerProjection,
      resolveUserKey,
    });
    // The identical forged transition is refused when its predecessor is
    // supplied and the verifier actually checks the signed document chain.
    await expect(
      verifyDocumentPurgeProof({
        execSql: database.execSql,
        expectedDocumentId: proof.documentId,
        expectedOrganizationId: owner.author.organizationId,
        proof: {
          ...proof,
          documentManifestPredecessors: [original],
          documentManifestContainerPaths: [
            ...proof.documentManifestContainerPaths,
            ...owner.writerProjection.documentManifestContainerPaths,
          ],
          documentContainerManifestHistory: [
            ...proof.documentContainerManifestHistory,
            ...owner.writerProjection.documentContainerManifestHistory,
          ],
        },
        resolveUserKey,
      }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });

    const requestedFloors: (string | undefined)[] = [];
    let deletions = 0;
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: {
        getDocumentPurgeProof: async (_documentId, options) => {
          requestedFloors.push(options?.documentCheckpointManifestHash);
          return proof;
        },
      },
      execSql: database.execSql,
      expectedOrganizationId: owner.author.organizationId,
      onVerifiedDeletion: async ({ commitPurgeProof }) => {
        await commitPurgeProof(database.execSql);
        deletions += 1;
      },
      resolveProjectionUserKey: resolveUserKey,
    });
    await expect(
      handler({ documentId: proof.documentId }),
    ).rejects.toMatchObject({
      code: "stale_predecessor",
    });
    expect(requestedFloors).toEqual([undefined]);
    expect(deletions).toBe(0);
    expect(
      await loadAccessManifestCheckpoint(
        database.execSql,
        "document",
        owner.author.organizationId,
        proof.documentId,
      ),
    ).toMatchObject({ manifestHash: original.manifestHash, epoch: 1 });
  } finally {
    database.close();
  }
});
