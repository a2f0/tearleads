import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { purgeRemoteDocument } from "./purge";

for (const scenario of ["outside", "inside", "late-refusal"]) {
  const inside = scenario !== "outside";
  const allowed = scenario === "inside";
  test(`document purge checks its signed authorization path (${scenario})`, async () => {
    const fixture = await createMaterializedSyncFixture();
    const { author, resolveProjectionUserKey, writerProjection } = fixture;
    const containerId =
      writerProjection.authorizingContainerPaths[0]?.containerId;
    if (!containerId) throw new Error("Expected authorizing container");
    const proof = await createDocumentPurgeProof(author, writerProjection);
    const { close, execSql } = await createTestExecSql("purge-subtree-path");
    let submissions = 0;
    let submissionChecks = 0;
    let commits = 0;
    try {
      const result = purgeRemoteDocument({
        apiClient: {
          getDocumentPurgeProof: async () => null,
          getDocumentWriterProjectionResult: async () => ({
            ok: true,
            data: writerProjection,
          }),
          purgeDocument: async () => {
            submissions += 1;
            return { ...proof, reclaimedBlobStorageKeys: [] };
          },
        },
        author,
        beforeSubmit: async () => {
          submissionChecks += 1;
          return allowed;
        },
        documentId: writerProjection.documentId,
        expectedSubtreeRootId: inside ? containerId : crypto.randomUUID(),
        execSql,
        onVerifiedPurge: async ({ commitPurgeProof }) => {
          await commitPurgeProof(execSql);
          commits += 1;
        },
        resolveProjectionUserKey,
      });
      if (allowed) expect(await result).not.toBeNull();
      else if (inside) expect(await result).toBeNull();
      else
        await expect(result).rejects.toThrow(
          "outside the requested purge subtree",
        );
      expect(submissionChecks).toBe(inside ? 1 : 0);
      expect(submissions).toBe(allowed ? 1 : 0);
      expect(commits).toBe(allowed ? 1 : 0);
    } finally {
      close();
    }
  });
}
