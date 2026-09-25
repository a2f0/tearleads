import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../src/workflows/containers/child/create";
import { buildMaterializedContainerRekeyPlan } from "../../src/workflows/containers/child/rekey";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../../src/workflows/documents/linkSet";
import { createUploadedAttachmentFixture } from "./blobHydrationFixture";
import {
  createLinkSetResponseFromRequest,
  createMaterializedSyncFixture,
  writerProjectionEvidence,
} from "./documentFixtures";

export async function createRelinkScopeFixture() {
  const source = await createMaterializedSyncFixture();
  const setup = await createTestExecSql("relink-scope-setup");
  try {
    const identity = {
      encapsulationPublicKey: source.publicKey,
      organizationId: source.author.organizationId,
      signerKeyFingerprint: source.author.signerKeyFingerprint,
      signerPrivateKey: source.author.signerPrivateKey,
      userId: source.author.signerUserId,
    };
    const retired = await createContainerWriterProjectionFixture({
      ...identity,
      containerId: "omitted-linked-container",
    });
    const rotated = await buildMaterializedContainerRekeyPlan({
      execSql: setup.execSql,
      author: source.author,
      previousProjection: retired,
      resolveProjectionUserKey: source.resolveProjectionUserKey,
      targetSecretKey: source.secretKey,
    });
    const linked = await buildMaterializedDocumentLinkSetMutationPlan({
      execSql: setup.execSql,
      author: source.author,
      operation: "link",
      prepareBlobRewraps: async () => [],
      resolveProjectionUserKey: source.resolveProjectionUserKey,
      targetContainerProjection: rotated.writerProjection,
      targetSecretKey: source.secretKey,
      writerProjection: source.writerProjection,
    });
    const response = await createLinkSetResponseFromRequest(
      source.writerProjection.documentId,
      linked.plan.request,
    );
    const projections = [source.projection, rotated.writerProjection];
    const writerProjection: DocumentWriterProjectionResponse = {
      documentId: response.id,
      documentManifest: response.accessManifest,
      documentKekTargets: response.documentKekTargets,
      contentKeyBundle: response.contentKeyBundle,
      authorizingContainerPaths: projections,
      ...writerProjectionEvidence(projections, [
        source.writerProjection.documentManifest,
      ]),
    };
    // The blob key is freshly generated after B rotated. No envelope has ever
    // disclosed this key under B's retired epoch.
    const uploaded = await createUploadedAttachmentFixture({
      documentFixture: { ...source, writerProjection },
    });
    const child = await buildMaterializedContainerCreatePlan({
      author: source.author,
      execSql: setup.execSql,
      containerId: "new-destination",
      parentProjection: rotated.writerProjection,
      parentSecretKey: source.secretKey,
      resolveProjectionUserKey: source.resolveProjectionUserKey,
    });
    const destination = childContainerWriterProjectionFromCreatePlan({
      parentProjection: rotated.writerProjection,
      materializedPlan: child,
    });
    return {
      ...uploaded,
      destination,
      retired,
      rotated: rotated.writerProjection,
    };
  } finally {
    setup.close();
  }
}
