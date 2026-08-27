import {
  type AccessManifest,
  type AccessManifestCheckpoint,
  type VerifiedAccessManifestCheckpointEvidence,
  verifyAccessManifestLocalCheckpoint,
} from "@symcrypt/crypto";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";

interface ManifestCheckpointVerificationInput<
  TManifest extends VerifiedAccessManifestCheckpointEvidence,
> {
  readonly checkpointPredecessors: readonly TManifest[];
  readonly localCheckpoint: AccessManifestCheckpoint | null;
}

function isCheckpointPredecessor(input: {
  readonly candidate: VerifiedAccessManifestCheckpointEvidence;
  readonly current: AccessManifest;
  readonly localCheckpoint: AccessManifestCheckpoint;
}): boolean {
  const candidate = input.candidate.checkpoint;
  return (
    candidate.objectKind === input.current.objectKind &&
    candidate.organizationId === input.current.organizationId &&
    candidate.objectId === input.current.objectId &&
    candidate.epoch > input.localCheckpoint.epoch &&
    candidate.epoch < input.current.epoch
  );
}

export async function loadManifestCheckpointVerification<
  TManifest extends VerifiedAccessManifestCheckpointEvidence,
>(input: {
  readonly current: AccessManifest;
  readonly execSql: ExecSql;
  readonly verifiedManifests: ReadonlyMap<string, TManifest>;
}): Promise<ManifestCheckpointVerificationInput<TManifest>> {
  const localCheckpoint = await loadAccessManifestCheckpoint(
    input.execSql,
    input.current.objectKind,
    input.current.organizationId,
    input.current.objectId,
  );
  const checkpointPredecessors = localCheckpoint
    ? [...input.verifiedManifests.values()]
        .filter((candidate) =>
          isCheckpointPredecessor({
            candidate,
            current: input.current,
            localCheckpoint,
          }),
        )
        .sort((left, right) => left.checkpoint.epoch - right.checkpoint.epoch)
    : [];
  return { checkpointPredecessors, localCheckpoint };
}

export async function verifyCachedManifestCheckpoint(input: {
  readonly current: VerifiedAccessManifestCheckpointEvidence;
  readonly execSql: ExecSql;
  readonly verifiedManifests: ReadonlyMap<
    string,
    VerifiedAccessManifestCheckpointEvidence
  >;
}): Promise<void> {
  const checkpoint = await loadManifestCheckpointVerification({
    current: input.current.manifest,
    execSql: input.execSql,
    verifiedManifests: input.verifiedManifests,
  });
  verifyAccessManifestLocalCheckpoint({
    checkpointPredecessors: checkpoint.checkpointPredecessors,
    current: {
      ...input.current.checkpoint,
      previousManifestHash: input.current.manifest.previousManifestHash,
    },
    localCheckpoint: checkpoint.localCheckpoint,
  });
}
