import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createHistoricalPolicyPurgeFixture } from "../../../../test/helpers/workflows/documentPurgeHistoricalPolicy";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../../workflows/documents/purge";
import { upsertAccessManifestCheckpointInTransaction } from "../../persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { KeyingCheckpointRepository } from "../../persistence/keyingCheckpoints/keyingCheckpointRepository";
import { openPrincipalPolicyBundleReader } from "../../persistence/principalPolicy/principalPolicyBundleRepository";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { verifyDocumentPurgeProofBaseline } from "./documentPurgeProofVerification";

test("a pinned purge head still verifies policy evidence used only by earlier links", async () => {
  const fixture = await createHistoricalPolicyPurgeFixture();
  const database = await createTestExecSql("purge-pinned-historical-policy");
  try {
    // Validate all real signatures and authorization before seeding a device's
    // existing document pin. Page recovery may persist disposable history, but
    // baseline verification does not admit document or policy checkpoints.
    const baseline = await verifyDocumentPurgeProofBaseline({
      execSql: database.execSql,
      openPrincipalPolicyBundleReader,
      warmReferencedPrincipalPolicies: fixture.warmer(database.execSql),
      expectedDocumentId: fixture.proof.documentId,
      expectedOrganizationId: "organization-1",
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
    });
    const pin = baseline.documentCheckpoint;
    expect(pin.epoch).toBe(5);
    expect(
      await new KeyingCheckpointRepository(
        database.execSql,
      ).loadAccessManifestCheckpoint(
        "document",
        pin.organizationId,
        pin.objectId,
      ),
    ).toBeNull();
    await getClientSQLitePersistenceRuntime(database.execSql).transaction(
      (tx) =>
        upsertAccessManifestCheckpointInTransaction(
          tx,
          pin,
          "2026-09-28T00:00:00.000Z",
        ),
    );
    let deletions = 0;
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: { getDocumentPurgeProof: async () => fixture.proof },
      execSql: database.execSql,
      expectedOrganizationId: pin.organizationId,
      resolveProjectionUserKey: fixture.resolveUserKey,
      warmReferencedPrincipalPolicies: fixture.warmer(database.execSql),
      onVerifiedDeletion: async ({ commitPurgeProof }) => {
        await commitPurgeProof(database.execSql);
        deletions += 1;
      },
    });
    await handler({ documentId: fixture.proof.documentId });
    expect(deletions).toBe(1);
  } finally {
    database.close();
  }
});
