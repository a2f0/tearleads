import {
  type ContainerKekKeyringEntry,
  KeyingVerificationError,
} from "@tearleads/crypto";

const LABEL = "Container rekey keyring override";

/**
 * A rebuilt keyring override is sealed forward under this device's signature,
 * so it must name exactly the epochs the container's signed lineage commits to
 * (#2365 finding 32). `signedEpochIds` is that lineage as the rotation's own
 * verification walked it, wherever the projection served it: the target KEK's
 * own served history is not enough, since a server can serve the target's
 * older manifests under its parent's KEK, letting an invented id over
 * server-chosen material take the real epoch's ordinal.
 */
export function assertOverrideMatchesSignedLineage(
  entries: readonly ContainerKekKeyringEntry[],
  signedEpochIds: ReadonlySet<string>,
): void {
  const entryIds = new Set(entries.map((entry) => entry.containerKeyEpochId));
  for (const epochId of entryIds) {
    if (!signedEpochIds.has(epochId)) {
      throw new KeyingVerificationError(
        "object_mismatch",
        `${LABEL} names an epoch outside the container's signed lineage`,
      );
    }
  }
  for (const epochId of signedEpochIds) {
    if (!entryIds.has(epochId)) {
      // Honest when the container rotated after the rebuild: rebuild again.
      throw new KeyingVerificationError(
        "missing_dependency",
        `${LABEL} omits an epoch the container's signed lineage names`,
      );
    }
  }
}
