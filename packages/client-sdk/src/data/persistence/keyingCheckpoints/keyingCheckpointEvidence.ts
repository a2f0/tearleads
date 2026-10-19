import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
} from "@tearleads/crypto";
import { accessManifestObjectKey } from "./keyingCheckpointPersistence";

/** Structural consistency applies even when local currency prevents acceptance. */
export function validateAccessManifestCheckpointEvidence(input: {
  readonly head: VerifiedAccessManifestCheckpointEvidence;
  readonly predecessors: readonly VerifiedAccessManifestCheckpointEvidence[];
  readonly localCheckpoint: AccessManifestCheckpoint | null;
}): void {
  const current = input.head.checkpoint;
  const { predecessors, localCheckpoint } = input;
  const hashByEpoch = new Map<number, string>();
  for (const predecessor of predecessors) {
    if (
      accessManifestObjectKey(predecessor.checkpoint) !==
      accessManifestObjectKey(current)
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "access manifest checkpoint evidence belongs to another object",
      );
    }
    const previousHash = hashByEpoch.get(predecessor.checkpoint.epoch);
    if (previousHash && previousHash !== predecessor.manifestHash) {
      throw new KeyingVerificationError(
        "equivocation",
        `access manifest checkpoint evidence conflicts at epoch ${predecessor.checkpoint.epoch}`,
      );
    }
    hashByEpoch.set(predecessor.checkpoint.epoch, predecessor.manifestHash);
    if (
      predecessor.checkpoint.epoch === current.epoch &&
      predecessor.manifestHash !== current.manifestHash
    ) {
      throw new KeyingVerificationError(
        "equivocation",
        "access manifest checkpoint evidence conflicts with the declared head",
      );
    }
    if (
      localCheckpoint &&
      predecessor.checkpoint.epoch === localCheckpoint.epoch &&
      predecessor.manifestHash !== localCheckpoint.manifestHash
    ) {
      throw new KeyingVerificationError(
        "equivocation",
        "access manifest checkpoint evidence conflicts with the local checkpoint",
      );
    }
    if (predecessor.checkpoint.epoch > current.epoch) {
      throw new KeyingVerificationError(
        "stale_predecessor",
        "access manifest checkpoint evidence is newer than the declared head",
      );
    }
  }
}
