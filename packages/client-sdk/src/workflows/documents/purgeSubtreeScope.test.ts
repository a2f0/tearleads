import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { purgeRemoteDocument } from "./purge";

for (const scenario of ["outside", "restored-root", "inside", "late-refusal"]) {
  const inside = scenario === "inside" || scenario === "late-refusal";
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
        // The fixture container is a signed top-level root. A root restored
        // from the parent it was selected under must not authorize its document.
        expectedSubtreeRoot: {
          id: scenario === "outside" ? crypto.randomUUID() : containerId,
          parentId: scenario === "restored-root" ? "trash" : null,
        },
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
