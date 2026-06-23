import {
  type BlobContentKeyTarget,
  computeBlobContentKeyTargetHash,
  type KeyingCanonicalJson,
  KeyingVerificationError,
} from "@tearleads/crypto";
import type { resolveCurrentBlobKekTargets } from "./blobKekTargets";
import {
  assertContentKeyWrappedMaterialPresent,
  assertNoDuplicateContentKeyTargets,
  contentKeyTargetEnvelopeEqual,
  contentKeyTargetEnvelopeMaterialEqual,
  expectedContentKeyTargetMap,
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

export function targetKey(
  target: Pick<
    BlobContentKeyTarget,
    "bindingId" | "containerId" | "documentId"
  >,
) {
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
  return sortContentKeyTargetEnvelopes(targets, targetKey);
}

function targetFieldsEqual(
  left: BlobContentKeyTarget,
  right: BlobContentKeyTarget,
): boolean {
  return (
    left.bindingId === right.bindingId &&
    left.documentId === right.documentId &&
    left.containerId === right.containerId &&
    left.containerManifestHash === right.containerManifestHash &&
    left.containerKeyEpochId === right.containerKeyEpochId &&
    left.containerKeyEpoch === right.containerKeyEpoch
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
  return contentKeyTargetEnvelopeEqual(left, right, targetFieldsEqual);
}

export function targetEnvelopeMaterialEqual(
  left: BlobContentKeyTargetEnvelope,
  right: BlobContentKeyTargetEnvelope,
): boolean {
  return contentKeyTargetEnvelopeMaterialEqual(
    left,
    right,
    targetKeyMaterialEqual,
  );
}

export function ensurePositiveContentKeyEpoch(contentKeyEpoch: number): void {
  if (!Number.isInteger(contentKeyEpoch) || contentKeyEpoch <= 0) {
    throw new BlobContentKeyBundleError(
      "Blob content key epoch must be a positive integer",
      400,
    );
  }
}

function assertNoDuplicateTargets(
  targets: readonly BlobContentKeyTargetEnvelope[],
): void {
  assertNoDuplicateContentKeyTargets(
    targets,
    targetKey,
    () =>
      new BlobContentKeyBundleError(
        "Blob content-key targets contain duplicates",
        409,
      ),
  );
}

function assertWrappedMaterialPresent(
  targets: readonly BlobContentKeyTargetEnvelope[],
): void {
  assertContentKeyWrappedMaterialPresent(
    targets,
    () =>
      new BlobContentKeyBundleError(
        "Blob content-key target is missing wrapped key material",
        400,
      ),
  );
}

function expectedTargetMap(
  targets: readonly BlobContentKeyTarget[],
): Map<string, BlobContentKeyTarget> {
  return expectedContentKeyTargetMap(targets, targetKey);
}

export function assertTargetsMatchCurrent(input: {
  readonly currentTargets: CurrentBlobKekTargets;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): void {
  assertNoDuplicateTargets(input.targets);
  assertWrappedMaterialPresent(input.targets);

  const currentTargetByKey = expectedTargetMap(input.currentTargets.targets);

  if (input.targets.length !== currentTargetByKey.size) {
    throw new BlobContentKeyBundleError(
      "Blob content-key targets do not match current KEK targets",
      409,
    );
  }

  for (const target of input.targets) {
    const currentTarget = currentTargetByKey.get(targetKey(target));
    if (!currentTarget || !targetFieldsEqual(target, currentTarget)) {
      throw new BlobContentKeyBundleError(
        "Blob content-key targets do not match current KEK targets",
        409,
      );
    }
  }
}

export async function assertTargetHashMatches(input: {
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): Promise<void> {
  try {
    const targetHash = await computeBlobContentKeyTargetHash(
      input.targets.map(toTargetFields),
    );

    if (targetHash !== input.targetHash) {
      throw new BlobContentKeyBundleError(
        "Blob content-key target hash mismatch",
        409,
      );
    }
  } catch (error) {
    if (error instanceof BlobContentKeyBundleError) {
      throw error;
    }
    if (error instanceof KeyingVerificationError) {
      throw new BlobContentKeyBundleError(error.message, 409);
    }
    throw error;
  }
}
