import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { purgeRemoteDocument } from "./purge";

for (const inside of [false, true]) {
  test(`document purge checks its signed authorization path (inside: ${inside})`, async () => {
    const fixture = await createMaterializedSyncFixture();
    const { author, resolveProjectionUserKey, writerProjection } = fixture;
    const containerId =
      writerProjection.authorizingContainerPaths[0]?.containerId;
    if (!containerId) throw new Error("Expected authorizing container");
    const proof = await createDocumentPurgeProof(author, writerProjection);
    const { close, execSql } = await createTestExecSql("purge-subtree-path");
    let submissions = 0;
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
        documentId: writerProjection.documentId,
        expectedSubtreeRootId: inside ? containerId : crypto.randomUUID(),
        execSql,
        onVerifiedPurge: async ({ commitPurgeProof }) => {
          await commitPurgeProof(execSql);
          commits += 1;
        },
        resolveProjectionUserKey,
      });
      if (inside) expect(await result).not.toBeNull();
      else
        await expect(result).rejects.toThrow(
          "outside the requested purge subtree",
        );
      expect(submissions).toBe(inside ? 1 : 0);
      expect(commits).toBe(inside ? 1 : 0);
    } finally {
      close();
    }
  });
}
