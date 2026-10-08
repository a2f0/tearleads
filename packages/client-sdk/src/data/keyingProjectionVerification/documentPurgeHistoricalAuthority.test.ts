import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createHistoricalPolicyPurgeFixture } from "../../../test/helpers/documentPurgeHistoricalPolicy";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";

test("purge uses authority already verified during paging when the directory binds a newer Admins head", async () => {
  const database = await createTestExecSql(
    "purge-historical-external-authority",
  );
  const fixture = await createHistoricalPolicyPurgeFixture(true);
  try {
    const verified = await verifyDocumentPurgeProof({
      execSql: database.execSql,
      expectedDocumentId: fixture.proof.documentId,
      expectedOrganizationId: "organization-1",
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
      warmReferencedPrincipalPolicies: fixture.warmer(database.execSql),
    });
    await verified.commitCheckpoints();
    const admins = fixture.proof.policyEvidence.groups.find(
      ({ head }) => head.version === 2,
    );
    if (!admins) throw new Error("Missing newer Admins source");
    expect(
      await loadPrincipalPolicyCheckpoint(
        database.execSql,
        "group",
        admins.head.principalId,
      ),
    ).toMatchObject({ version: 2, stateHash: admins.head.stateHash });
  } finally {
    database.close();
  }
});
