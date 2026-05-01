import type { ContainerKeyEpoch, KeyingCanonicalJson } from "@tearleads/crypto";
import { serializeKeyingCanonicalJson } from "@tearleads/crypto";

export function canonicalJsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  return (
    serializeKeyingCanonicalJson(left as KeyingCanonicalJson) ===
    serializeKeyingCanonicalJson(right as KeyingCanonicalJson)
  );
}

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
