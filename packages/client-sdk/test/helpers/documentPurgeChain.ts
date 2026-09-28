import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../../src/workflows/documents/linkSet";
import { createMaterializedSyncFixture } from "./documentFixtures";
import { createDocumentPurgeProof } from "./documentPurge";
import { createLinkSetResponseFromRequest } from "./documentResponseFixtures";

function uniqueContainerPaths(
  paths: readonly (readonly DocumentWriterProjectionResponse["documentManifest"][])[],
) {
  return [
    ...new Map(
      paths.map((path) => [path.at(-1)?.manifestHash, [...path]]),
    ).values(),
  ];
}

function projectionAfterMutation(input: {
  operation: "link" | "unlink";
  previous: DocumentWriterProjectionResponse;
  response: DocumentLinkSetMutationResponse;
  target: ContainerWriterProjectionResponse;
}): DocumentWriterProjectionResponse {
  const retained = input.previous.authorizingContainerPaths.filter(
    (projection) => projection.containerId !== input.target.containerId,
  );
  const authorizingContainerPaths =
    input.operation === "link" ? [...retained, input.target] : retained;
  const documentManifestContainerPaths = uniqueContainerPaths([
    ...input.previous.documentManifestContainerPaths,
    input.target.path,
  ]);
  return {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths,
    contentKeyBundle: input.response.contentKeyBundle,
    documentContainerManifestHistory: [
      ...input.previous.documentContainerManifestHistory,
      ...input.target.path,
      ...input.target.containerKeks.flatMap(
        (key) => key.containerManifestHistory,
      ),
    ],
    documentId: input.response.id,
    documentKekTargets: input.response.documentKekTargets,
    documentManifest: input.response.accessManifest,
    documentManifestContainerPaths,
    documentManifestHistory: [
      input.previous.documentManifest,
      ...input.previous.documentManifestHistory,
    ],
  };
}

export async function createPurgeChainFixture() {
  const fixture = await createMaterializedSyncFixture();
  const extraProjection = await createContainerWriterProjectionFixture({
    containerId: "purge-chain-extra-container",
    encapsulationPublicKey: fixture.publicKey,
    organizationId: fixture.author.organizationId,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const linkedPlan = await buildMaterializedDocumentLinkSetMutationPlan({
    prepareBlobRewraps: async () => [],
    author: fixture.author,
    operation: "link",
    targetContainerProjection: extraProjection,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const linkedResponse = await createLinkSetResponseFromRequest(
    fixture.writerProjection.documentId,
    linkedPlan.plan.request,
  );
  const linkedProjection = projectionAfterMutation({
    operation: "link",
    previous: fixture.writerProjection,
    response: linkedResponse,
    target: extraProjection,
  });
  const unlinkedPlan = await buildMaterializedDocumentLinkSetMutationPlan({
    prepareBlobRewraps: async () => [],
    author: fixture.author,
    operation: "unlink",
    targetContainerProjection: extraProjection,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: linkedProjection,
  });
  const unlinkedResponse = await createLinkSetResponseFromRequest(
    fixture.writerProjection.documentId,
    unlinkedPlan.plan.request,
  );
  const headProjection = projectionAfterMutation({
    operation: "unlink",
    previous: linkedProjection,
    response: unlinkedResponse,
    target: extraProjection,
  });
  const proof = await createDocumentPurgeProof(fixture.author, headProjection);
  return {
    ...fixture,
    extraProjection,
    linkedProjection,
    proof: {
      ...proof,
      documentManifestPredecessors: headProjection.documentManifestHistory,
    },
  };
}
