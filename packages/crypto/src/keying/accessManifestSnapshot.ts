import {
  computeAccessManifestHash,
  normalizeAccessManifest,
} from "./accessEvent";
import {
  accessManifestCheckpointFromManifest,
  type VerifiedAccessManifestCheckpointEvidence,
  verifyAccessManifestLocalCheckpoint,
} from "./checkpoints";
import {
  deriveDocumentLinkSetManifest,
  normalizeDocumentLinkSetManifestState,
} from "./documentAccess";
import { runVerifier, throwVerification } from "./shared";
import type {
  AccessManifest,
  AccessManifestCheckpoint,
  KeyingVerificationResult,
  VerifiedDocumentLinkSetSnapshot,
} from "./types";
import { makeVerifiedDocumentLinkSetSnapshot } from "./types";

const verifiedAccessManifestSnapshotBrand: unique symbol = Symbol(
  "verifiedAccessManifestSnapshot",
);

export interface VerifiedAccessManifestSnapshot {
  readonly checkpoint: AccessManifestCheckpoint;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly [verifiedAccessManifestSnapshotBrand]: true;
}

function verifiedAccessManifestSnapshot(input: {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
}): VerifiedAccessManifestSnapshot {
  return {
    ...input,
    checkpoint: accessManifestCheckpointFromManifest(input),
    [verifiedAccessManifestSnapshotBrand]: true,
  };
}

export async function verifyAccessManifestSnapshot(input: {
  readonly expectedManifestHash: string;
  readonly manifest: AccessManifest;
}): Promise<KeyingVerificationResult<VerifiedAccessManifestSnapshot>> {
  return runVerifier(async () => {
    const manifest = normalizeAccessManifest(input.manifest);
    const manifestHash = await computeAccessManifestHash(manifest);
    if (manifestHash !== input.expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "access manifest snapshot hash does not match expected hash",
      );
    }
    return verifiedAccessManifestSnapshot({ manifest, manifestHash });
  });
}

export async function verifyDocumentLinkSetSnapshot(input: {
  readonly checkpointPredecessors?:
    | readonly VerifiedAccessManifestCheckpointEvidence[]
    | undefined;
  readonly expectedManifestHash: string;
  readonly localCheckpoint?: AccessManifestCheckpoint | null | undefined;
  readonly manifest: AccessManifest;
  readonly state: unknown;
}): Promise<KeyingVerificationResult<VerifiedDocumentLinkSetSnapshot>> {
  return runVerifier(async () => {
    const state = normalizeDocumentLinkSetManifestState(input.state);
    const derivedManifest = await deriveDocumentLinkSetManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);
    if (derivedManifestHash !== input.expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "document link-set snapshot hash does not match derived state",
      );
    }
    const verifiedManifest = await verifyAccessManifestSnapshot({
      expectedManifestHash: input.expectedManifestHash,
      manifest: input.manifest,
    });
    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }
    verifyAccessManifestLocalCheckpoint({
      checkpointPredecessors: input.checkpointPredecessors,
      current: {
        ...verifiedManifest.value.checkpoint,
        previousManifestHash:
          verifiedManifest.value.manifest.previousManifestHash,
      },
      localCheckpoint: input.localCheckpoint,
    });
    return makeVerifiedDocumentLinkSetSnapshot({
      ...verifiedManifest.value,
      state,
    });
  });
}
