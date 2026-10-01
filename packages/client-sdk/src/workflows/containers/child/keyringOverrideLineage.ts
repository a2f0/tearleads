import {
  type ContainerKekKeyringEntry,
  KeyingVerificationError,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  verifiedContainerLineage,
  verifyContainerDestinationProjection,
} from "../../../data/keyingProjectionVerification/containerDestinationVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

const LABEL = "Container rekey keyring override";

/**
 * A rebuilt keyring override is sealed forward under this device's signature,
 * so it must name exactly the epochs the container's signed lineage commits to
 * (#2365 finding 32). The target KEK's own served history is not enough:
 * projection verification pools every KEK's history, so a server can serve the
 * target's older manifests under its parent's KEK. The lineage still verifies,
 * the per-KEK check finds nothing to anchor, and an invented id over
 * server-chosen material takes the real epoch's ordinal.
 */
export async function assertOverrideInSignedLineage(
  input: {
    readonly execSql: ExecSql;
    readonly keyringEntriesOverride?:
      | readonly ContainerKekKeyringEntry[]
      | undefined;
    readonly previousProjection: ContainerWriterProjectionResponse;
  },
  resolveUserKey: ProjectionUserKeyResolver,
): Promise<void> {
  const entries = input.keyringEntriesOverride;
  if (!entries) return;
  const { path, verifiedByHash } = await verifyContainerDestinationProjection({
    execSql: input.execSql,
    projection: input.previousProjection,
    resolveUserKey,
  });
  const head = path.at(-1);
  if (!head) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${LABEL} has no verified head`,
    );
  }
  const signedEpochIds = new Set<string>();
  for (const manifest of verifiedContainerLineage({
    head,
    label: LABEL,
    verifiedByHash,
  })) {
    const epochId = manifest.state.containerKeyEpochId;
    if (epochId !== null && epochId !== head.state.containerKeyEpochId) {
      signedEpochIds.add(epochId);
    }
  }
  const entryIds = entries.map((entry) => entry.containerKeyEpochId);
  if (
    entryIds.length !== signedEpochIds.size ||
    entryIds.some((epochId) => !signedEpochIds.has(epochId))
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      `${LABEL} names an epoch outside the container's signed lineage`,
    );
  }
}
