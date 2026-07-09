import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTarget,
  type KeyingCanonicalJson,
} from "@tearleads/crypto";
import {
  assertContentKeyTargetHashMatches,
  assertContentKeyTargetsMatchCurrent,
  assertPositiveContentKeyEpoch,
  contentKeyTargetEnvelopeEqualBy,
  sortContentKeyTargetEnvelopes,
} from "./contentKeyTargetPolicy";
import type { resolveCurrentDocumentKekTargets } from "./documentKekTargets";

export type CurrentDocumentKekTargets = Awaited<
  ReturnType<typeof resolveCurrentDocumentKekTargets>
>;

export interface DocumentContentKeyTargetEnvelope
  extends DocumentContentKeyTarget {
  readonly wrappedKey: string;
  readonly wrappingMetadata: KeyingCanonicalJson;
}

export interface StoredDocumentContentKeyBundle {
  readonly documentId: string;
  readonly contentKeyEpoch: number;
  readonly linkSetManifestHash: string;
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}

export interface StoredDocumentContentKeyBundleWithTargets
  extends StoredDocumentContentKeyBundle {
  readonly currentTargets: CurrentDocumentKekTargets;
}

export class DocumentContentKeyBundleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "DocumentContentKeyBundleError";
  }
}

function targetKey(target: DocumentContentKeyTarget) {
  return target.containerId;
}

function toTargetFields(
  envelope: DocumentContentKeyTargetEnvelope,
): DocumentContentKeyTarget {
  return {
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

export function sortTargetEnvelopes(
  targets: readonly DocumentContentKeyTargetEnvelope[],
): DocumentContentKeyTargetEnvelope[] {
  return sortContentKeyTargetEnvelopes<DocumentContentKeyTargetEnvelope>(
    targets,
    targetKey,
  );
}

function targetFieldsEqual(
  left: DocumentContentKeyTarget,
  right: DocumentContentKeyTarget,
): boolean {
  return (
    targetKeyMaterialEqual(left, right) &&
    left.containerManifestHash === right.containerManifestHash
  );
}

export function targetKeyMaterialEqual(
  left: DocumentContentKeyTarget,
  right: DocumentContentKeyTarget,
): boolean {
  return (
    left.containerId === right.containerId &&
    left.containerKeyEpochId === right.containerKeyEpochId &&
    left.containerKeyEpoch === right.containerKeyEpoch
  );
}

export function targetEnvelopeEqual(
  left: DocumentContentKeyTargetEnvelope,
  right: DocumentContentKeyTargetEnvelope,
): boolean {
  return contentKeyTargetEnvelopeEqualBy<DocumentContentKeyTargetEnvelope>(
    left,
    right,
    targetFieldsEqual,
  );
}

export function targetEnvelopeMaterialEqual(
  left: DocumentContentKeyTargetEnvelope,
  right: DocumentContentKeyTargetEnvelope,
): boolean {
  return contentKeyTargetEnvelopeEqualBy<DocumentContentKeyTargetEnvelope>(
    left,
    right,
    targetKeyMaterialEqual,
  );
}

export function ensurePositiveContentKeyEpoch(contentKeyEpoch: number): void {
  assertPositiveContentKeyEpoch(
    contentKeyEpoch,
    () =>
      new DocumentContentKeyBundleError(
        "Document content key epoch must be a positive integer",
        400,
      ),
  );
}

function contentKeyTargetMismatchError(): DocumentContentKeyBundleError {
  return new DocumentContentKeyBundleError(
    "Document content-key targets do not match current KEK targets",
    409,
  );
}

export function assertTargetsMatchCurrent(input: {
  readonly currentTargets: CurrentDocumentKekTargets;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}): void {
  assertContentKeyTargetsMatchCurrent({
    currentTargets: input.currentTargets.targets,
    targets: input.targets,
    targetKey,
    targetFieldsEqual,
    createDuplicateError: () =>
      new DocumentContentKeyBundleError(
        "Document content-key targets contain duplicate containers",
        409,
      ),
    createMissingWrappedMaterialError: () =>
      new DocumentContentKeyBundleError(
        "Document content-key target is missing wrapped key material",
        400,
      ),
    createMismatchError: contentKeyTargetMismatchError,
  });
}

export async function assertTargetHashMatches(input: {
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}): Promise<void> {
  await assertContentKeyTargetHashMatches({
    ...input,
    toTargetFields,
    computeTargetHash: computeDocumentContentKeyTargetHash,
    createHashMismatchError: () =>
      new DocumentContentKeyBundleError(
        "Document content-key target hash mismatch",
        409,
      ),
    createVerificationError: (message) =>
      new DocumentContentKeyBundleError(message, 409),
  });
}
