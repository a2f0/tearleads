import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createHistoricalPolicyPurgeFixture } from "../../../test/helpers/documentPurgeHistoricalPolicy";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../workflows/documents/purge";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { verifyDocumentPurgeProofBaseline } from "./documentPurgeProofVerification";

test("a pinned purge head still verifies policy evidence used only by earlier links", async () => {
  const fixture = await createHistoricalPolicyPurgeFixture();
  const database = await createTestExecSql("purge-pinned-historical-policy");
  try {
    // Validate all real signatures and authorization before seeding a device's
    // existing document pin. Baseline verification must not read local pins.
    const baseline = await verifyDocumentPurgeProofBaseline({
      execSql: async () => {
        throw new Error("Unexpected baseline checkpoint read");
      },
      expectedDocumentId: fixture.proof.documentId,
      expectedOrganizationId: "organization-1",
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
    });
    const pin = baseline.documentCheckpoint;
    expect(pin.epoch).toBe(5);
    await loadAccessManifestCheckpoint(
      database.execSql,
      "document",
      pin.organizationId,
      pin.objectId,
    );
    await database.execSql(
      `INSERT INTO access_manifest_checkpoints
       (object_kind, organization_id, object_id, epoch, manifest_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        pin.objectKind,
        pin.organizationId,
        pin.objectId,
        pin.epoch,
        pin.manifestHash,
        "2026-09-28T00:00:00.000Z",
      ],
    );
    let deletions = 0;
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: { getDocumentPurgeProof: async () => fixture.proof },
      execSql: database.execSql,
      expectedOrganizationId: pin.organizationId,
      resolveProjectionUserKey: fixture.resolveUserKey,
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
