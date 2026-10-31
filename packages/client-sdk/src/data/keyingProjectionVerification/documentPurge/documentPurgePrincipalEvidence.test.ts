import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../../test/helpers/documentPurge";
import { PIN_PRINCIPAL_POLICY_CHECKPOINT_SQL } from "../../../../test/helpers/principalPolicyCheckpointPins";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../../test/helpers/principalPolicySnapshots";
import { projectionPolicySource } from "../../../../test/helpers/projectionPolicyHistory";
import { loadPrincipalPolicyCheckpoint } from "../../persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";

test("purge rejects unrelated policy evidence before consulting its checkpoint", async () => {
  const fixture = await createMaterializedSyncFixture();
  const policyFixture =
    await createExternallyAuthorizedPrincipalPolicySnapshots();
  const proof = await createDocumentPurgeProof(
    fixture.author,
    fixture.writerProjection,
  );
  const { close, execSql } = await createTestExecSql(
    "document-purge-unrelated-policy",
  );
  const unrelatedState = policyFixture.admin.currentState;
  try {
    await loadPrincipalPolicyCheckpoint(
      execSql,
      unrelatedState.principalType,
      unrelatedState.principalId,
    );
    await execSql(PIN_PRINCIPAL_POLICY_CHECKPOINT_SQL, [
      unrelatedState.principalType,
      unrelatedState.principalId,
      unrelatedState.version,
      "f".repeat(64),
      "2026-08-27T00:00:00.000Z",
      fixture.author.organizationId,
    ]);

    await expect(
      verifyDocumentPurgeProof({
        execSql,
        expectedDocumentId: fixture.writerProjection.documentId,
        expectedOrganizationId: fixture.author.organizationId,
        proof: {
          ...proof,
          policyEvidence: {
            organization: null,
            organizationPayloads: [],
            groups: [projectionPolicySource(policyFixture.adminBundle)],
          },
        },
        resolveUserKey: async (userId) =>
          (await fixture.resolveProjectionUserKey(userId)) ??
          policyFixture.resolveUserKey(userId),
      }),
    ).rejects.toMatchObject({
      code: "invalid_shape",
      message:
        "Document purge proof includes unrelated principal policy evidence",
    });
  } finally {
    close();
  }
});
