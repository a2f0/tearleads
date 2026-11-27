import { expect, test } from "bun:test";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createLinkSetResponseFromRequest } from "../../../../test/helpers/data/documentFixtures";
import { createRemoteDocumentServiceFixture } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import { createLinkedDocumentFixture } from "../../../../test/helpers/workflows/stagedBaselineUnlink";

for (const scenario of ["outside", "restored-root", "inside", "late-refusal"]) {
  const inside = scenario === "inside" || scenario === "late-refusal";
  const allowed = scenario === "inside";
  test(`subtree unlink checks the exact signed target path (${scenario})`, async () => {
    const fixture = await createLinkedDocumentFixture();
    const { close, execSql } = await createTestExecSql("unlink-subtree-path");
    let submissions = 0;
    let submissionChecks = 0;
    try {
      const result = createRemoteDocumentServiceFixture({
        api: createMockApiClient({
          getContainerWriterProjection: async () => fixture.child,
          getDocumentWriterProjection: async () => fixture.writerProjection,
          listDocumentAttachments: async () => [],
          primeDocumentWriterProjection: () => {},
          unlinkDocument: async (documentId, request) => {
            submissions += 1;
            return createLinkSetResponseFromRequest(documentId, request);
          },
        }),
        encapsulationSecretKey: fixture.secretKey,
        execSql,
      }).relinkRemoteDocument({
        author: fixture.author,
        beforeSubmit: async () => {
          submissionChecks += 1;
          return allowed;
        },
        documentId: fixture.writerProjection.documentId,
        expectedSubtreeRoot: {
          id:
            scenario === "outside"
              ? crypto.randomUUID()
              : fixture.parent.containerId,
          parentId: scenario === "restored-root" ? "trash" : null,
        },
        operation: "unlink",
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        rotationSnapshot: exportFullHistorySnapshot(
          await createDocument("subtree-unlink"),
        ),
        targetContainerId: fixture.child.containerId,
      });
      if (allowed)
        expect((await result)?.linkedContainerIds).toEqual([
          fixture.parent.containerId,
        ]);
      else if (inside) expect(await result).toBeNull();
      else
        await expect(result).rejects.toThrow(
          "outside the requested purge subtree",
        );
      expect(submissionChecks).toBe(inside ? 1 : 0);
      expect(submissions).toBe(allowed ? 1 : 0);
    } finally {
      close();
    }
  });
}
