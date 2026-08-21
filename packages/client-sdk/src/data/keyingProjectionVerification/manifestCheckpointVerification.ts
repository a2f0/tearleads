import {
  type AccessManifest,
  type AccessManifestCheckpoint,
  type AnyVerifiedAccessManifest,
  verifyAccessManifestLocalCheckpoint,
} from "@symcrypt/crypto";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";

interface ManifestCheckpointVerificationInput {
  readonly checkpointPredecessors: readonly AnyVerifiedAccessManifest[];
  readonly localCheckpoint: AccessManifestCheckpoint | null;
}

function isCheckpointPredecessor(input: {
  readonly candidate: AnyVerifiedAccessManifest;
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

export async function loadManifestCheckpointVerification(input: {
  readonly current: AccessManifest;
  readonly execSql: ExecSql;
  readonly verifiedManifests: ReadonlyMap<string, AnyVerifiedAccessManifest>;
}): Promise<ManifestCheckpointVerificationInput> {
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
  readonly current: AnyVerifiedAccessManifest;
  readonly execSql: ExecSql;
  readonly verifiedManifests: ReadonlyMap<string, AnyVerifiedAccessManifest>;
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
