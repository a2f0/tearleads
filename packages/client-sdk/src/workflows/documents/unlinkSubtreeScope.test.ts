import { expect, test } from "bun:test";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  createLinkSetResponseFromRequest,
  createMaterializedSyncFixture,
  writerProjectionEvidence,
} from "../../../test/helpers/documentFixtures";
import { buildMaterializedDocumentLinkSetMutationPlan } from "./linkSet";
import { relinkRemoteDocument } from "./linkSetRemote";

async function createLinkedFixture() {
  const source = await createMaterializedSyncFixture();
  const path = source.writerProjection.authorizingContainerPaths[0];
  if (!path) throw new Error("Expected parent projection");
  const parent = Object.assign(path, {
    policyEvidence: source.writerProjection.policyEvidence,
  });
  const child = await createContainerWriterProjectionFixture({
    containerId: crypto.randomUUID(),
    encapsulationPublicKey: source.publicKey,
    organizationId: source.author.organizationId,
    parentProjection: parent,
    signerKeyFingerprint: source.author.signerKeyFingerprint,
    signerPrivateKey: source.author.signerPrivateKey,
    userId: source.author.signerUserId,
  });
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author: source.author,
    operation: "link",
    prepareBlobRewraps: async () => [],
    targetContainerProjection: child,
    targetSecretKey: source.secretKey,
    trustedLocalProjection: true,
    writerProjection: source.writerProjection,
  });
  const response = await createLinkSetResponseFromRequest(
    source.writerProjection.documentId,
    linked.plan.request,
  );
  return {
    ...source,
    parent,
    child,
    writerProjection: {
      ...source.writerProjection,
      authorizingContainerPaths: [parent, child],
      ...writerProjectionEvidence(
        [parent, child],
        [source.writerProjection.documentManifest],
      ),
      contentKeyBundle: response.contentKeyBundle,
      documentKekTargets: response.documentKekTargets,
      documentManifest: response.accessManifest,
    },
  };
}

for (const scenario of ["outside", "inside", "late-refusal"]) {
  const inside = scenario !== "outside";
  const allowed = scenario === "inside";
  test(`subtree unlink checks the exact signed target path (${scenario})`, async () => {
    const fixture = await createLinkedFixture();
    const { close, execSql } = await createTestExecSql("unlink-subtree-path");
    let submissions = 0;
    let submissionChecks = 0;
    try {
      const result = relinkRemoteDocument({
        apiClient: createMockApiClient({
          getContainerWriterProjection: async () => fixture.child,
          getDocumentWriterProjection: async () => fixture.writerProjection,
          listDocumentAttachments: async () => [],
          primeDocumentWriterProjection: () => {},
          unlinkDocument: async (documentId, request) => {
            submissions += 1;
            return createLinkSetResponseFromRequest(documentId, request);
          },
        }),
        author: fixture.author,
        beforeSubmit: async () => {
          submissionChecks += 1;
          return allowed;
        },
        documentId: fixture.writerProjection.documentId,
        expectedSubtreeRootId: inside
          ? fixture.parent.containerId
          : crypto.randomUUID(),
        execSql,
        operation: "unlink",
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        rotationSnapshot: exportFullHistorySnapshot(
          await createDocument("subtree-unlink"),
        ),
        targetContainerId: fixture.child.containerId,
        targetSecretKey: fixture.secretKey,
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
