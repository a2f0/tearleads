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
 * Explicit signed folders for Explorer tests that exercise remote discovery. A
 * root the session acknowledges as its own must be created by the session
 * user (the SDK refuses any other creator), so such tests pass that user id.
 */
export async function createSignedExplorerDirectory(
  containers: readonly (Pick<
    ContainerSummary,
    "id" | "organizationId" | "metadataDocumentId"
  > & { readonly parentId?: string | null })[],
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
  const load = (id: string): Promise<ContainerWriterProjectionResponse> => {
    const pending = projections.get(id);
    if (pending) return pending;
    const container = containers.find((container) => container.id === id);
    if (!container) throw new Error(`Unknown signed Explorer folder: ${id}`);
    const projection = (async () =>
      createContainerWriterProjectionFixture({
        containerId: id,
        metadataDocumentId: container.metadataDocumentId,
        organizationId: container.organizationId,
        parentProjection: container.parentId
          ? await load(container.parentId)
          : undefined,
        userId,
        signerKeyFingerprint: fingerprint,
        signerPrivateKey: signer.signingPrivateKey,
        encapsulationPublicKey: kem.publicKey,
      }))();
    projections.set(id, projection);
    return projection;
  };
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
      return containers.some((container) => container.id === id)
        ? load(id)
        : null;
    },
  };
}
