import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createHistoricalPolicyPurgeFixture } from "../../../test/helpers/documentPurgeHistoricalPolicy";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import {
  verifyDocumentPurgeProof,
  verifyDocumentPurgeProofBaseline,
} from "./documentPurgeProofVerification";
import { runWithSecurityIncidentReporting } from "./error";

test("an authenticated purge without a connection to a newer policy pin defers without an incident", async () => {
  const database = await createTestExecSql("purge-policy-unavailable");
  const fixture = await createHistoricalPolicyPurgeFixture();
  const source = fixture.proof.policyEvidence.groups[0];
  if (!source) throw new Error("Missing source");
  const incidents: unknown[] = [];
  try {
    await loadPrincipalPolicyCheckpoint(
      database.execSql,
      "group",
      source.head.principalId,
    );
    await database.execSql(
      `INSERT INTO principal_policy_checkpoints
      (principal_type, principal_id, version, state_hash, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [
        "group",
        source.head.principalId,
        2,
        "f".repeat(64),
        "2026-10-08T00:00:00.000Z",
      ],
    );
    const input = {
      execSql: database.execSql,
      expectedDocumentId: fixture.proof.documentId,
      expectedOrganizationId: "organization-1",
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
      warmReferencedPrincipalPolicies: fixture.warmer(database.execSql),
    };
    expect(
      (await verifyDocumentPurgeProofBaseline(input)).documentCheckpoint
        .objectId,
    ).toBe(fixture.proof.documentId);
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        {
          operation: "document.purge",
          objectKind: "document",
          objectId: fixture.proof.documentId,
        },
        () => verifyDocumentPurgeProof(input),
      ),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(incidents).toEqual([]);
    expect(
      await loadPrincipalPolicyCheckpoint(
        database.execSql,
        "group",
        source.head.principalId,
      ),
    ).toMatchObject({ version: 2, stateHash: "f".repeat(64) });
  } finally {
    database.close();
  }
});
