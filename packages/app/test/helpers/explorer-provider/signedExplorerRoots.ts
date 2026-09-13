import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type {
  ContainerSummary,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";

/**
 * Explicit signed roots for Explorer tests that exercise remote discovery. A
 * root the session acknowledges as its own must be created by the session
 * user (the SDK refuses any other creator), so such tests pass that user id.
 */
export async function createSignedExplorerRoots(
  roots: readonly Pick<
    ContainerSummary,
    "id" | "organizationId" | "metadataDocumentId"
  >[],
  options: { readonly userId?: string | undefined } = {},
) {
  const signer = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signer.signingPublicKey);
  const encapsulationKeyFingerprint = await toFingerprint(kem.publicKey);
  const userId = options.userId ?? "explorer-root-owner";
  const projections = new Map<
    string,
    Promise<ContainerWriterProjectionResponse>
  >();
  return {
    getUserIdentity: async (requestedUserId: string) =>
      requestedUserId === userId
        ? {
            userId,
            signingKeyFingerprint: fingerprint,
            signingPublicKey: bytesToBase64(signer.signingPublicKey),
            encapsulationKeyFingerprint,
            encapsulationPublicKey: bytesToBase64(kem.publicKey),
          }
        : null,
    getContainerWriterProjection: async (id: string) => {
      const root = roots.find((root) => root.id === id);
      if (!root) return null;
      let projection = projections.get(id);
      if (!projection) {
        projection = createContainerWriterProjectionFixture({
          containerId: id,
          metadataDocumentId: root.metadataDocumentId,
          organizationId: root.organizationId,
          userId,
          signerKeyFingerprint: fingerprint,
          signerPrivateKey: signer.signingPrivateKey,
          encapsulationPublicKey: kem.publicKey,
        });
        projections.set(id, projection);
      }
      return projection;
    },
  };
}
