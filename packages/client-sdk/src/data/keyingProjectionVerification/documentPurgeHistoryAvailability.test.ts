import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPurgeChainFixture } from "../../../test/helpers/documentPurgeChain";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../workflows/documents/purge";
import { verifyDocumentWriterProjection } from "./documentProjectionVerification";
import { verifyDocumentPurgeProofBaseline } from "./documentPurgeProofVerification";
import { runWithSecurityIncidentReporting } from "./error";

test("initial purge history must reach genesis before reading local pins", async () => {
  const fixture = await createPurgeChainFixture();
  await expect(
    verifyDocumentPurgeProofBaseline({
      execSql: async () => {
        throw new Error("Unexpected local checkpoint read");
      },
      expectedDocumentId: fixture.proof.documentId,
      expectedOrganizationId: fixture.author.organizationId,
      proof: {
        ...fixture.proof,
        documentManifestPredecessors:
          fixture.proof.documentManifestPredecessors.slice(0, 1),
      },
      resolveUserKey: fixture.resolveProjectionUserKey,
    }),
  ).rejects.toMatchObject({
    code: "missing_dependency",
    message: "Initial document purge history does not reach signed genesis",
  });
});

test("a terminal snapshot without observed history defers deletion without an incident", async () => {
  const fixture = await createPurgeChainFixture();
  const database = await createTestExecSql("purge-unavailable-history");
  let deletions = 0;
  const incidents: unknown[] = [];
  try {
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: {
        getDocumentPurgeProof: async () => ({
          ...fixture.proof,
          documentManifestPredecessors: [],
        }),
      },
      execSql: database.execSql,
      expectedOrganizationId: fixture.author.organizationId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      onVerifiedDeletion: () => {
        deletions += 1;
      },
    });
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
        () => handler({ documentId: fixture.proof.documentId }),
      ),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(deletions).toBe(0);
    expect(incidents).toEqual([]);
  } finally {
    database.close();
  }
});

test("an initial purge chain containing the local pin needs no bounded refetch", async () => {
  const fixture = await createPurgeChainFixture();
  const database = await createTestExecSql("purge-complete-initial-history");
  const requestedFloors: (string | undefined)[] = [];
  let deletions = 0;
  try {
    await verifyDocumentWriterProjection({
      execSql: database.execSql,
      projection: fixture.linkedProjection,
      resolveUserKey: fixture.resolveProjectionUserKey,
    });
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: {
        getDocumentPurgeProof: async (_id, options) => {
          requestedFloors.push(options?.documentCheckpointManifestHash);
          if (options) throw new Error("Unexpected bounded refetch");
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
  } finally {
    database.close();
  }
});
