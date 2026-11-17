import {
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type {
  BlobAttachmentSummary,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { contentKeyTargetReference } from "../../../src/data/blobs/attachments/readers";
import type { DocumentLinkSetMutationFailure } from "../../../src/data/documents/shared/types";
import { buildMaterializedDocumentCreatePlan } from "../../../src/workflows/documents/create";
import {
  createAuthor,
  createResponse,
  writerProjectionEvidence,
} from "../data/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../data/trustedUserIdentity";

/** A created document and a sibling destination for one link or unlink leg. */
export async function linkLegFixture(name: string) {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const fixture = {
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: "reuse-organization",
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const projection = await createContainerWriterProjectionFixture({
    ...fixture,
    containerId: `${name}-root`,
  });
  const sibling = await createContainerWriterProjectionFixture({
    ...fixture,
    containerId: `${name}-sibling`,
    parentProjection: projection,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: `${name}-document`,
    targetSecretKey: keyPair.secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    ...writerProjectionEvidence([projection], []),
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  return {
    author,
    keyPair,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    sibling,
    writerProjection,
  };
}

/** The `linkDocumentResult` failure a mock API answers with. */
export function linkSetRefusal(
  documentId: string,
  failure: DocumentLinkSetMutationFailure,
  onReport: () => void = () => {},
) {
  return {
    ...failure,
    kind: "http" as const,
    method: "POST" as const,
    ok: false as const,
    path: `/documents/${documentId}/link`,
    report: onReport,
    statusText: "Conflict",
  };
}

/** `binding` as listed once its blob carries exactly `targets`. */
export async function bindingWithTargets(
  binding: BlobAttachmentSummary,
  projection: DocumentWriterProjectionResponse,
  targets: BlobAttachmentSummary["contentKeyBundle"]["targets"],
): Promise<BlobAttachmentSummary> {
  const references = targets.map(contentKeyTargetReference);
  const targetHash = await computeBlobContentKeyTargetHash(references);
  const current = {
    ...binding.blobKekTargets,
    documentManifestHashes: [projection.documentManifest.manifestHash],
    linkedContainerManifestHashes: references
      .map((target) => target.containerManifestHash)
      .sort(),
    linkedContainerKeyEpochIds: references
      .map((target) => target.containerKeyEpochId)
      .sort(),
    targets: references.map((target) => ({ ...target })),
    blobKeyTargetHash: targetHash,
  };
  const { targets: _targets, blobAccessManifestHash: _old, ...rest } = current;
  return {
    ...binding,
    blobKekTargets: {
      ...current,
      blobAccessManifestHash: await computeBlobAccessManifestHash({
        version: 1,
        ...rest,
      }),
    },
    contentKeyBundle: { ...binding.contentKeyBundle, targetHash, targets },
  };
}
