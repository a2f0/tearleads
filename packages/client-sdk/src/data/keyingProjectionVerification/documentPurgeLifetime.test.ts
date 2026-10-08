import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createHistoricalPolicyPurgeFixture } from "../../../test/helpers/documentPurgeHistoricalPolicy";
import { loadDocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../sqlite/sqlSchema";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";

test("purge rolls back terminal pins and teardown when its lease expires before the outer commit", async () => {
  const database = await createTestExecSql("purge-outer-commit-lifetime");
  const fixture = await createHistoricalPolicyPurgeFixture();
  let current = true;
  const original = fixture.warmer(database.execSql);
  const warmer = Object.assign(async () => {}, {
    resolveProjectionHistory: async (
      input: Parameters<
        NonNullable<typeof original.resolveProjectionHistory>
      >[0],
    ) => {
      const resolved = await original.resolveProjectionHistory?.(input);
      if (!resolved) throw new Error("Missing paged fixture resolver");
      return {
        ...resolved,
        stillCurrent: () => current && resolved.stillCurrent(),
      };
    },
  });
  try {
    await database.execSql("CREATE TABLE purge_teardown_probe (value INTEGER)");
    await database.execSql("INSERT INTO purge_teardown_probe VALUES (1)");
    const verified = await verifyDocumentPurgeProof({
      execSql: database.execSql,
      expectedDocumentId: fixture.proof.documentId,
      expectedOrganizationId: "organization-1",
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
      warmReferencedPrincipalPolicies: warmer,
    });
    await expect(
      runSerializedSqlMutation(database.execSql, async (execSql) => {
        await getClientSQLitePersistenceRuntime(execSql).transaction(
          async () => {
            await verified.commitCheckpoints(execSql);
            await execSql("DELETE FROM purge_teardown_probe");
            current = false;
          },
        );
      }),
    ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
    expect(
      await database.execSql("SELECT value FROM purge_teardown_probe"),
    ).toEqual([{ value: 1 }]);
    expect(
      await loadDocumentPurgeCheckpoint(
        database.execSql,
        fixture.proof.documentId,
      ),
    ).toBeNull();
    for (const source of [
      fixture.proof.policyEvidence.organization,
      ...fixture.proof.policyEvidence.groups,
    ]) {
      if (!source) continue;
      expect(
        await loadPrincipalPolicyCheckpoint(
          database.execSql,
          source.head.principalType,
          source.head.principalId,
        ),
      ).toBeNull();
    }
  } finally {
    database.close();
  }
});
