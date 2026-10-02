import {
  type ContainerKekKeyringEntry,
  KeyingVerificationError,
} from "@tearleads/crypto";

const LABEL = "Container rekey keyring override";

/**
 * A rebuilt keyring override that omits an epoch the container's signed
 * lineage names. That is what a rebuild made before a concurrent rotation
 * looks like, so it is not tampering: rebuild from the current log and retry.
 * It is deliberately not a `KeyingVerificationError`, which callers may read
 * as tampering, unlike an epoch outside the lineage, which no honest rebuild
 * names.
 */
export class ContainerKeyringOverrideStaleError extends Error {
  constructor() {
    super(
      `${LABEL} omits an epoch the container's signed lineage names; rebuild it from the current log`,
    );
    this.name = "ContainerKeyringOverrideStaleError";
  }
}

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
      throw new ContainerKeyringOverrideStaleError();
    }
  }
}
