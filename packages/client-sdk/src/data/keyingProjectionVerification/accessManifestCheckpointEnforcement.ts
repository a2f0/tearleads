import {
  type AnyVerifiedAccessManifest,
  verifyAccessManifestLocalCheckpoint,
} from "@tearleads/crypto";
import {
  loadAccessManifestCheckpoint,
  saveAccessManifestCheckpoint,
} from "../persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";

function objectKey(manifest: AnyVerifiedAccessManifest): string {
  const { objectKind, organizationId, objectId } = manifest.checkpoint;
  return JSON.stringify([objectKind, organizationId, objectId]);
}

function groupByObject(
  manifests: readonly AnyVerifiedAccessManifest[],
): Map<string, AnyVerifiedAccessManifest[]> {
  // Dedupe by manifest hash within each object; the same manifest can be
  // observed through several paths in one projection.
  const byObject = new Map<string, Map<string, AnyVerifiedAccessManifest>>();
  for (const manifest of manifests) {
    const key = objectKey(manifest);
    let group = byObject.get(key);
    if (!group) {
      group = new Map();
      byObject.set(key, group);
    }
    group.set(manifest.manifestHash, manifest);
  }

  return new Map(
    [...byObject.entries()].map(([key, group]) => [key, [...group.values()]]),
  );
}

/**
 * Enforce anti-rollback pins for every object observed in a verified
 * projection, then advance each pin to the newest verified epoch.
 *
 * For each object the newest verified manifest is the head; the verified
 * manifests strictly between the pinned epoch and the head are passed as
 * `checkpointPredecessors` so the crypto layer can confirm the head extends
 * the pinned chain. A rollback (older epoch), equivocation (same epoch,
 * different hash), or broken predecessor link throws — the caller refuses to
 * unwrap keys.
 *
 * Callers must pass only manifests whose newest verified epoch is the object's
 * head (e.g. a container projection's path + history). Manifests referenced at
 * a historical epoch (such as a document projection's authorizing container
 * paths) must not be enforced here, since their epoch is not the object head.
 */
export async function enforceAccessManifestCheckpoints(input: {
  readonly execSql?: ExecSql | undefined;
  readonly verifiedManifests: readonly AnyVerifiedAccessManifest[];
}): Promise<void> {
  const { execSql } = input;
  if (!execSql) {
    return;
  }

  const updatedAt = new Date().toISOString();

  for (const manifests of groupByObject(input.verifiedManifests).values()) {
    const sorted = [...manifests].sort(
      (left, right) => left.checkpoint.epoch - right.checkpoint.epoch,
    );
    const head = sorted[sorted.length - 1];
    if (!head) {
      continue;
    }

    const headEpoch = head.checkpoint.epoch;
    if (
      sorted.some(
        (manifest) =>
          manifest.checkpoint.epoch === headEpoch &&
          manifest.manifestHash !== head.manifestHash,
      )
    ) {
      throw new Error(
        `Access manifest projection equivocates at epoch ${headEpoch} for ${head.checkpoint.objectKind} ${head.checkpoint.objectId}`,
      );
    }

    const localCheckpoint = await loadAccessManifestCheckpoint(
      execSql,
      head.checkpoint.objectKind,
      head.checkpoint.organizationId,
      head.checkpoint.objectId,
    );

    const checkpointPredecessors =
      localCheckpoint === null
        ? undefined
        : sorted.filter(
            (manifest) =>
              manifest.checkpoint.epoch > localCheckpoint.epoch &&
              manifest.checkpoint.epoch < headEpoch,
          );

    verifyAccessManifestLocalCheckpoint({
      current: {
        ...head.checkpoint,
        previousManifestHash: head.manifest.previousManifestHash,
      },
      localCheckpoint,
      checkpointPredecessors,
    });

    await saveAccessManifestCheckpoint(execSql, head.checkpoint, updatedAt);
  }
}
