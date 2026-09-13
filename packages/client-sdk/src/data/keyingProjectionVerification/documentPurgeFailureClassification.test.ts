import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentPurgeProofResponse } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshots";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../workflows/documents/purge";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";
import { runWithSecurityIncidentReporting } from "./error";
import { ProjectionVerificationCancelledError } from "./types";

test("a malformed purge proof is still recorded as integrity evidence", async () => {
  const database = await createTestExecSql("purge-malformed-proof");
  const incidents: unknown[] = [];
  try {
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        { operation: "document.purge", objectKind: "document", objectId: null },
        () =>
          verifyDocumentPurgeProof({
            execSql: database.execSql,
            expectedDocumentId: "document",
            expectedOrganizationId: "organization",
            proof: {} as DocumentPurgeProofResponse,
            resolveUserKey: async () => null,
          }),
      ),
    ).rejects.toMatchObject({ code: "invalid_shape" });
    expect(incidents).toHaveLength(1);
  } finally {
    database.close();
  }
});

for (const failure of [
  new Error("identity request failed"),
  new ProjectionVerificationCancelledError(),
]) {
  test(`purge verification preserves ${failure.name} without an incident`, async () => {
    const fixture = await createMaterializedSyncFixture();
    const proof = await createDocumentPurgeProof(
      fixture.author,
      fixture.writerProjection,
    );
    const database = await createTestExecSql("purge-failure-classification");
    const incidents: unknown[] = [];
    try {
      await expect(
        runWithSecurityIncidentReporting(
          async (error) => {
            incidents.push(error);
          },
          {
            operation: "document.purge",
            objectKind: "document",
            objectId: null,
          },
          () =>
            verifyDocumentPurgeProof({
              execSql: database.execSql,
              expectedDocumentId: proof.documentId,
              expectedOrganizationId: fixture.author.organizationId,
              proof,
              resolveUserKey: async () => {
                throw failure;
              },
            }),
        ),
      ).rejects.toBe(failure);
      expect(incidents).toEqual([]);
    } finally {
      database.close();
    }
  });
}

test("an unavailable purge signer is retryable", async () => {
  const fixture = await createMaterializedSyncFixture();
  const snapshots = await createExternallyAuthorizedPrincipalPolicySnapshots();
  const proof = await createDocumentPurgeProof(
    fixture.author,
    fixture.writerProjection,
  );
  const database = await createTestExecSql("purge-signer-unavailable");
  try {
    await expect(
      verifyDocumentPurgeProof({
        execSql: database.execSql,
        expectedDocumentId: proof.documentId,
        expectedOrganizationId: fixture.author.organizationId,
        proof: { ...proof, principalPolicySnapshots: [snapshots.admin] },
        resolveUserKey: async () => null,
      }),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
  } finally {
    database.close();
  }
});

test("an unavailable purge proof never commits deletion or records tampering", async () => {
  const database = await createTestExecSql("purge-proof-unavailable");
  let deletions = 0;
  const incidents: unknown[] = [];
  try {
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: { getDocumentPurgeProof: async () => null },
      execSql: database.execSql,
      expectedOrganizationId: "organization",
      onVerifiedDeletion: () => {
        deletions += 1;
      },
      resolveProjectionUserKey: async () => null,
    });
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        { operation: "document.purge", objectKind: "document", objectId: null },
        () => handler({ documentId: "document" }),
      ),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(deletions).toBe(0);
    expect(incidents).toEqual([]);
  } finally {
    database.close();
  }
});
