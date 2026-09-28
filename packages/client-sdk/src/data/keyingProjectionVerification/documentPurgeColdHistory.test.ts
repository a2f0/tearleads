import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPurgeChainFixture } from "../../../test/helpers/documentPurgeChain";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../workflows/documents/purge";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import {
  verifyDocumentPurgeProof,
  verifyDocumentPurgeProofBaseline,
} from "./documentPurgeProofVerification";

test("a fresh device verifies purge history from signed genesis without pinning the baseline", async () => {
  const fixture = await createPurgeChainFixture();
  const database = await createTestExecSql("purge-cold-history");
  const input = {
    execSql: database.execSql,
    expectedDocumentId: fixture.proof.documentId,
    expectedOrganizationId: fixture.author.organizationId,
    proof: fixture.proof,
    resolveUserKey: fixture.resolveProjectionUserKey,
  };
  try {
    const baseline = await verifyDocumentPurgeProofBaseline(input);
    expect(baseline.documentCheckpoint.manifestHash).toBe(
      fixture.proof.documentManifest.manifestHash,
    );
    expect(
      await loadAccessManifestCheckpoint(
        database.execSql,
        "document",
        fixture.author.organizationId,
        fixture.proof.documentId,
      ),
    ).toBeNull();
    const requestedFloors: (string | undefined)[] = [];
    let deletions = 0;
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: {
        getDocumentPurgeProof: async (_id, options) => {
          requestedFloors.push(options?.documentCheckpointManifestHash);
          return fixture.proof;
        },
      },
      execSql: database.execSql,
      expectedOrganizationId: fixture.author.organizationId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      onVerifiedDeletion: async ({ commitPurgeProof }) => {
        await commitPurgeProof(database.execSql);
        deletions += 1;
      },
    });
    await handler({ documentId: fixture.proof.documentId });
    expect(requestedFloors).toEqual([undefined]);
    expect(deletions).toBe(1);
    expect(
      await loadAccessManifestCheckpoint(
        database.execSql,
        "document",
        fixture.author.organizationId,
        fixture.proof.documentId,
      ),
    ).toMatchObject({
      epoch: 3,
      manifestHash: fixture.proof.documentManifest.manifestHash,
    });
    // A retry can use the exact pinned head without replaying its history.
    await expect(
      verifyDocumentPurgeProof({
        ...input,
        proof: { ...fixture.proof, documentManifestPredecessors: [] },
      }),
    ).resolves.toMatchObject({
      documentCheckpoint: baseline.documentCheckpoint,
    });
  } finally {
    database.close();
  }
});

test("a fresh device refuses a purge chain with a forged genesis signature", async () => {
  const fixture = await createPurgeChainFixture();
  const proof = structuredClone(fixture.proof);
  const genesis = proof.documentManifestPredecessors.at(-1);
  if (!genesis) throw new Error("Missing document genesis");
  Reflect.set(genesis.event.event, "signedAt", "2026-09-28T00:00:00.000Z");
  const database = await createTestExecSql("purge-forged-genesis");
  try {
    await expect(
      verifyDocumentPurgeProof({
        execSql: database.execSql,
        expectedDocumentId: proof.documentId,
        expectedOrganizationId: fixture.author.organizationId,
        proof,
        resolveUserKey: fixture.resolveProjectionUserKey,
      }),
    ).rejects.toThrow("signature verification failed");
    expect(
      await loadAccessManifestCheckpoint(
        database.execSql,
        "document",
        fixture.author.organizationId,
        proof.documentId,
      ),
    ).toBeNull();
  } finally {
    database.close();
  }
});
