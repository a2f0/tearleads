import {
  computeContainerKekLevelDigest,
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import {
  type ContainerKekWireLevel,
  isContainerKekWireLevel,
} from "@tearleads/validators/response";

/**
 * Typed rows in the verified-bundle cache that hold one container KEK level
 * each. `manifestHash` (the cache key) and `bundleDigest` are the level's
 * citation digest, the SHA-256 of `bundleJson`, its canonical wire bytes;
 * `objectId` and `epoch` are the level's container and key epoch.
 */
export const KEK_LEVEL_OBJECT_KIND = "container-kek-level";

/** A KEK level a projection verification accepted, with its organization. */
export interface VerifiedKekLevel {
  readonly kekLevel: ContainerKekWireLevel;
  readonly organizationId: string;
}

export interface KekLevelRow {
  readonly manifestHash: string;
  readonly organizationId: string;
  readonly objectKind: string;
  readonly objectId: string;
  readonly epoch: number;
  readonly bundleJson: string;
  readonly bundleDigest: string;
}

/** Null when the level has no canonical form; such a level is not cited. */
export async function kekLevelRow({
  kekLevel,
  organizationId,
}: VerifiedKekLevel): Promise<KekLevelRow | null> {
  const digest = await computeContainerKekLevelDigest(kekLevel);
  if (digest === null) return null;
  return {
    manifestHash: digest,
    organizationId,
    objectKind: KEK_LEVEL_OBJECT_KIND,
    objectId: kekLevel.containerId,
    epoch: kekLevel.containerKeyEpoch,
    // Canonical: the digest above is the SHA-256 of exactly these bytes.
    bundleJson: serializeKeyingCanonicalJson(
      readKeyingCanonicalJson(kekLevel, "Verified KEK level"),
    ),
    bundleDigest: digest,
  };
}

/**
 * The stored level, or null for a damaged row: its bytes must parse as a
 * full KEK level whose recomputed digest is the row's key.
 */
export async function readStoredKekLevel(row: {
  readonly bundleDigest: string;
  readonly bundleJson: string;
  readonly manifestHash: string;
}): Promise<ContainerKekWireLevel | null> {
  if (row.bundleDigest !== row.manifestHash) return null;
  try {
    const level: unknown = JSON.parse(row.bundleJson);
    return isContainerKekWireLevel(level) &&
      (await computeContainerKekLevelDigest(level)) === row.manifestHash
      ? level
      : null;
  } catch {
    return null;
  }
}
