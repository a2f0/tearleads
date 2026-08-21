import {
  type BlobContentKeyTarget,
  computeBlobContentKeyTargetHash,
  type KeyingCanonicalJson,
} from "@symcrypt/crypto";
import type { resolveCurrentBlobKekTargets } from "./blobKekTargets";
import { createContentKeyTargetPolicy } from "./contentKeyTargetPolicy";

export type CurrentBlobKekTargets = Awaited<
  ReturnType<typeof resolveCurrentBlobKekTargets>
>;

export interface BlobContentKeyTargetEnvelope extends BlobContentKeyTarget {
  readonly wrappedKey: string;
  readonly wrappingMetadata: KeyingCanonicalJson;
}

export interface StoredBlobContentKeyBundle {
  readonly blobId: string;
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}

export interface StoredBlobContentKeyBundleWithTargets
  extends StoredBlobContentKeyBundle {
  readonly currentTargets: CurrentBlobKekTargets;
}

export class BlobContentKeyBundleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "BlobContentKeyBundleError";
  }
}

export function targetKey(target: BlobContentKeyTarget) {
  return `${target.bindingId}:${target.documentId}:${target.containerId}`;
}

function toTargetFields(
  envelope: BlobContentKeyTargetEnvelope,
): BlobContentKeyTarget {
  return {
    bindingId: envelope.bindingId,
    documentId: envelope.documentId,
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

const contentKeyTargetPolicy = createContentKeyTargetPolicy<
  BlobContentKeyTarget,
  BlobContentKeyTargetEnvelope,
  CurrentBlobKekTargets
>({
  computeTargetHash: computeBlobContentKeyTargetHash,
  createError: (message, status) =>
    new BlobContentKeyBundleError(message, status),
  messages: {
    duplicateTargets: "Blob content-key targets contain duplicates",
    hashMismatch: "Blob content-key target hash mismatch",
    invalidEpoch: "Blob content key epoch must be a positive integer",
    missingWrappedMaterial:
      "Blob content-key target is missing wrapped key material",
    targetsMismatch:
      "Blob content-key targets do not match current KEK targets",
  },
  targetIdentityEqual: (left, right) =>
    left.bindingId === right.bindingId &&
    left.documentId === right.documentId &&
    left.containerId === right.containerId,
  targetKey,
  toTargetFields,
});

export const {
  assertTargetHashMatches,
  ensurePositiveContentKeyEpoch,
  sortTargetEnvelopes,
  targetEnvelopeEqual,
  targetEnvelopeMaterialEqual,
  targetKeyMaterialEqual,
} = contentKeyTargetPolicy;

export function assertTargetsMatchCurrent(input: {
  readonly currentTargets: CurrentBlobKekTargets;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): void {
  contentKeyTargetPolicy.assertTargetsMatchCurrent(input);
}
