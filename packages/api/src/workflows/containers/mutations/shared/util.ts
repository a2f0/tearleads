import type { ContainerKeyEpoch } from "@tearleads/crypto";

export { canonicalJsonEquals } from "../../../../utils/canonicalJson";

export function toContainerKeyEpoch(
  keyEpoch: ContainerKeyEpoch & { readonly createdAt?: Date },
): ContainerKeyEpoch {
  return {
    id: keyEpoch.id,
    containerId: keyEpoch.containerId,
    keyEpoch: keyEpoch.keyEpoch,
    accessManifestHash: keyEpoch.accessManifestHash,
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    createdByEventHash: keyEpoch.createdByEventHash,
    createdByManifestHash: keyEpoch.createdByManifestHash,
  };
}
