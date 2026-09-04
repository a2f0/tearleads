import {
  type AccessManifest,
  type AccessManifestCheckpoint,
  type VerifiedAccessManifestCheckpointEvidence,
  verifyAccessManifestLocalCheckpoint,
} from "@tearleads/crypto";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";

/**
 * The local checkpoint for one object, read once per verification: every
 * checkpoint-enforced element of a served path reads its own checkpoint, and
 * the currency rule reads it again. The verification itself commits nothing
 * until it has finished. A checkpoint another verification commits meanwhile
 * is not seen by this one: the atomic advance re-validates checkpoint order,
 * not the currency rule, so a head this pass accepts against the older
 * reading is held to the newer checkpoint on the next pass.
 */
export async function loadLocalAccessManifestCheckpoint(input: {
  readonly execSql: ExecSql;
  readonly localCheckpoints?:
    | Map<string, AccessManifestCheckpoint | null>
    | undefined;
  readonly objectId: string;
  readonly objectKind: AccessManifest["objectKind"];
  readonly organizationId: string;
}): Promise<AccessManifestCheckpoint | null> {
  const key = JSON.stringify([
    input.objectKind,
    input.organizationId,
    input.objectId,
  ]);
  const cached = input.localCheckpoints?.get(key);
  if (cached !== undefined) return cached;
  const loaded = await loadAccessManifestCheckpoint(
    input.execSql,
    input.objectKind,
    input.organizationId,
    input.objectId,
  );
  input.localCheckpoints?.set(key, loaded);
  return loaded;
}

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
  readonly localCheckpoints?:
    | Map<string, AccessManifestCheckpoint | null>
    | undefined;
  readonly verifiedManifests: ReadonlyMap<string, TManifest>;
}): Promise<ManifestCheckpointVerificationInput<TManifest>> {
  const localCheckpoint = await loadLocalAccessManifestCheckpoint({
    execSql: input.execSql,
    localCheckpoints: input.localCheckpoints,
    objectId: input.current.objectId,
    objectKind: input.current.objectKind,
    organizationId: input.current.organizationId,
  });
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
  readonly localCheckpoints?:
    | Map<string, AccessManifestCheckpoint | null>
    | undefined;
  readonly verifiedManifests: ReadonlyMap<
    string,
    VerifiedAccessManifestCheckpointEvidence
  >;
}): Promise<void> {
  const checkpoint = await loadManifestCheckpointVerification({
    current: input.current.manifest,
    execSql: input.execSql,
    localCheckpoints: input.localCheckpoints,
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
