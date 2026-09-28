import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createPurgeCurrencyFixture } from "../../../test/helpers/documentPurgeCurrency";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../workflows/documents/purge";
import { loadDocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import { sqlDocumentsPersistence } from "../persistence/documents/documentsPersistence";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";
import { runWithSecurityIncidentReporting } from "./error";

for (const [label, index] of [
  ["ancestor", 0],
  ["leaf", 1],
] as const) {
  test(`a purge predating a later ${label} checkpoint waits without an integrity incident`, async () => {
    const { execSql, close } = createNativeTestExecSql();
    const incidents: unknown[] = [];
    let deletions = 0;
    try {
      const { fixture, proof, head, advanceLater } =
        await createPurgeCurrencyFixture(execSql, index);
      await advanceLater();
      const handler = createVerifiedRemoteDocumentDeletionHandler({
        apiClient: { getDocumentPurgeProof: async () => proof },
        execSql,
        expectedOrganizationId: fixture.author.organizationId,
        onVerifiedDeletion: async ({ commitPurgeProof }) => {
          await commitPurgeProof(execSql);
          deletions += 1;
        },
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(
          runWithSecurityIncidentReporting(
            async (error) => {
              incidents.push(error);
            },
            {
              operation: "document.purge",
              objectKind: "document",
              objectId: proof.documentId,
            },
            () => handler({ documentId: proof.documentId }),
          ),
        ).rejects.toMatchObject({
          name: "ProjectionDependencyUnavailableError",
        });
      }
      expect(deletions).toBe(0);
      expect(incidents).toEqual([]);
      expect(
        await loadAccessManifestCheckpoint(
          execSql,
          "container",
          fixture.author.organizationId,
          head.state.containerId,
        ),
      ).toEqual(head.checkpoint);
      expect(
        await loadAccessManifestCheckpoint(
          execSql,
          "document",
          fixture.author.organizationId,
          proof.documentId,
        ),
      ).toBeNull();
    } finally {
      close();
    }
  });

  test(`a later ${label} checkpoint racing purge teardown preserves local data and pins`, async () => {
    const { execSql, close } = createNativeTestExecSql();
    try {
      const { verification, head, advanceLater, fixture } =
        await createPurgeCurrencyFixture(execSql, index);
      const verified = await verifyDocumentPurgeProof(verification);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.saveDocument(execSql, {
        accessEpoch: 1,
        containerId: fixture.projection.containerId,
        documentId: verification.expectedDocumentId,
        id: "retained-local-document",
        snapshotEndVersion: "frontier",
        text: "Retain this content",
      });
      const original = await sqlDocumentsPersistence.loadDocument(
        execSql,
        "retained-local-document",
      );
      if (!original) throw new Error("Expected stored local document");
      await advanceLater();
      await expect(
        sqlDocumentsPersistence.deleteDocumentIfMatches(
          execSql,
          original,
          verified.commitCheckpoints,
        ),
      ).rejects.toMatchObject({
        name: "ProjectionDependencyUnavailableError",
      });
      expect(
        await loadAccessManifestCheckpoint(
          execSql,
          "container",
          verification.expectedOrganizationId,
          head.state.containerId,
        ),
      ).toEqual(head.checkpoint);
      expect(
        await loadAccessManifestCheckpoint(
          execSql,
          "document",
          verification.expectedOrganizationId,
          verification.expectedDocumentId,
        ),
      ).toBeNull();
      expect(
        await loadDocumentPurgeCheckpoint(
          execSql,
          verification.expectedDocumentId,
        ),
      ).toBeNull();
      expect(
        await sqlDocumentsPersistence.loadDocument(execSql, original.id),
      ).toEqual(original);
    } finally {
      close();
    }
  });
}
