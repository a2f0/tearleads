import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createTestTrustedUserIdentityResolver } from "./trustedUserIdentity";

export async function createSignedContainerDirectory(
  input: readonly {
    id: string;
    parentId: string | null;
    metadataDocumentId?: string;
    organizationId?: string;
    systemSlot?: string | null;
  }[],
) {
  const signer = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signer.signingPublicKey);
  const projections = new Map<
    string,
    Promise<ContainerWriterProjectionResponse>
  >();
  const load = (id: string): Promise<ContainerWriterProjectionResponse> => {
    const pending = projections.get(id);
    if (pending) return pending;
    const entry = input.find((entry) => entry.id === id);
    if (!entry) throw new Error(`Unknown signed container fixture: ${id}`);
    const created = (async () =>
      createContainerWriterProjectionFixture({
        containerId: id,
        metadataDocumentId:
          entry.metadataDocumentId ?? `${id}-metadata-document`,
        organizationId: entry.organizationId ?? "org-1",
        systemSlot: entry.systemSlot ?? null,
        parentProjection: entry.parentId
          ? await load(entry.parentId)
          : undefined,
        userId: "user-1",
        signerKeyFingerprint: fingerprint,
        signerPrivateKey: signer.signingPrivateKey,
        encapsulationPublicKey: kem.publicKey,
      }))();
    projections.set(id, created);
    return created;
  };
  return {
    getContainerWriterProjection: load,
    resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
      userId: "user-1",
      signingKeyFingerprint: fingerprint,
      signingPublicKey: signer.signingPublicKey,
      encapsulationPublicKey: kem.publicKey,
    }),
  };
}
