import {
  type BlobContentKeyTarget,
  computeBlobContentKeyTargetHash,
  type KeyingCanonicalJson,
} from "@tearleads/crypto";
import type { resolveCurrentBlobKekTargets } from "./blobKekTargets";
import {
  assertContentKeyTargetHashMatches,
  assertContentKeyTargetsMatchCurrent,
  assertPositiveContentKeyEpoch,
  contentKeyTargetEnvelopeEqualBy,
  sortContentKeyTargetEnvelopes,
} from "./contentKeyTargetPolicy";

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

export function sortTargetEnvelopes(
  targets: readonly BlobContentKeyTargetEnvelope[],
): BlobContentKeyTargetEnvelope[] {
  return sortContentKeyTargetEnvelopes<BlobContentKeyTargetEnvelope>(
    targets,
    targetKey,
  );
}

function targetFieldsEqual(
  left: BlobContentKeyTarget,
  right: BlobContentKeyTarget,
): boolean {
  return (
    targetKeyMaterialEqual(left, right) &&
    left.containerManifestHash === right.containerManifestHash
  );
}

export function targetKeyMaterialEqual(
  left: BlobContentKeyTarget,
  right: BlobContentKeyTarget,
): boolean {
  return (
    left.bindingId === right.bindingId &&
    left.documentId === right.documentId &&
    left.containerId === right.containerId &&
    left.containerKeyEpochId === right.containerKeyEpochId &&
    left.containerKeyEpoch === right.containerKeyEpoch
  );
}

export function targetEnvelopeEqual(
  left: BlobContentKeyTargetEnvelope,
  right: BlobContentKeyTargetEnvelope,
): boolean {
  return contentKeyTargetEnvelopeEqualBy<BlobContentKeyTargetEnvelope>(
    left,
    right,
    targetFieldsEqual,
  );
}

export function targetEnvelopeMaterialEqual(
  left: BlobContentKeyTargetEnvelope,
  right: BlobContentKeyTargetEnvelope,
): boolean {
  return contentKeyTargetEnvelopeEqualBy<BlobContentKeyTargetEnvelope>(
    left,
    right,
    targetKeyMaterialEqual,
  );
}

export function ensurePositiveContentKeyEpoch(contentKeyEpoch: number): void {
  assertPositiveContentKeyEpoch(
    contentKeyEpoch,
    () =>
      new BlobContentKeyBundleError(
        "Blob content key epoch must be a positive integer",
        400,
      ),
  );
}

function contentKeyTargetMismatchError(): BlobContentKeyBundleError {
  return new BlobContentKeyBundleError(
    "Blob content-key targets do not match current KEK targets",
    409,
  );
}

export function assertTargetsMatchCurrent(input: {
  readonly currentTargets: CurrentBlobKekTargets;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): void {
  assertContentKeyTargetsMatchCurrent({
    currentTargets: input.currentTargets.targets,
    targets: input.targets,
    targetKey,
    targetFieldsEqual,
    createDuplicateError: () =>
      new BlobContentKeyBundleError(
        "Blob content-key targets contain duplicates",
        409,
      ),
    createMissingWrappedMaterialError: () =>
      new BlobContentKeyBundleError(
        "Blob content-key target is missing wrapped key material",
        400,
      ),
    createMismatchError: contentKeyTargetMismatchError,
  });
}

export async function assertTargetHashMatches(input: {
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): Promise<void> {
  await assertContentKeyTargetHashMatches({
    ...input,
    toTargetFields,
    computeTargetHash: computeBlobContentKeyTargetHash,
    createHashMismatchError: () =>
      new BlobContentKeyBundleError(
        "Blob content-key target hash mismatch",
        409,
      ),
    createVerificationError: (message) =>
      new BlobContentKeyBundleError(message, 409),
  });
}
