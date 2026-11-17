import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { buildMaterializedDocumentCreatePlan } from "../../src/workflows/documents/create";
import { createAuthor } from "./documentFixturePrimitives";
import { createResponse } from "./documentResponseFixtures";
import { createTestTrustedUserIdentityResolver } from "./trustedUserIdentity";

export async function createMaterializedSyncFixture(
  input: {
    containerId?: string;
    documentId?: string;
    organizationId?: string;
    userId?: string;
    nestedContainer?: boolean;
  } = {},
) {
  const { author, signingPublicKey } = await createAuthor(input);
  const keyPair = generateKemSeedAndKeyPair();
  const parentProjection = input.nestedContainer
    ? await createContainerWriterProjectionFixture({
        containerId: "materialized-sync-parent",
        encapsulationPublicKey: keyPair.publicKey,
        organizationId: author.organizationId,
        signerKeyFingerprint: author.signerKeyFingerprint,
        signerPrivateKey: author.signerPrivateKey,
        userId: author.signerUserId,
      })
    : undefined;
  const projection = await createContainerWriterProjectionFixture({
    parentProjection,
    containerId: input.containerId ?? "materialized-sync-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: input.documentId ?? "550e8400-e29b-41d4-a716-446655440010",
    eventId: "event-materialized-sync",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
    trustedLocalProjection: true,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    documentId: response.id,
    documentManifest: response.accessManifest,
    documentManifestHistory: [],
    documentManifestContainerPaths: [[...projection.path]],
    documentContainerManifestHistory: [
      ...projection.path,
      ...projection.containerKeks.flatMap(
        (kek) => kek.containerManifestHistory,
      ),
    ],
    documentKekTargets: response.documentKekTargets,
    contentKeyBundle: response.contentKeyBundle,
    authorizingContainerPaths: [projection],
  };

  return {
    author,
    contentKey,
    createResponse: response,
    parentProjection,
    projection,
    publicKey: keyPair.publicKey,
    resolveProjectionUserKey,
    secretKey: keyPair.secretKey,
    signingPublicKey,
    writerProjection,
  };
}
