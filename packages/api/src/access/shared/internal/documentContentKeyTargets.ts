import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTarget,
  type KeyingCanonicalJson,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";
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

function targetKey(target: Pick<DocumentContentKeyTarget, "containerId">) {
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
  return [...targets].sort((left, right) => {
    if (left.containerId < right.containerId) {
      return -1;
    }
    if (left.containerId > right.containerId) {
      return 1;
    }
    return 0;
  });
}

function targetFieldsEqual(
  left: DocumentContentKeyTarget,
  right: DocumentContentKeyTarget,
): boolean {
  return (
    left.containerId === right.containerId &&
    left.containerManifestHash === right.containerManifestHash &&
    left.containerKeyEpochId === right.containerKeyEpochId &&
    left.containerKeyEpoch === right.containerKeyEpoch
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
  return (
    targetFieldsEqual(left, right) &&
    left.wrappedKey === right.wrappedKey &&
    canonicalJsonEquals(left.wrappingMetadata, right.wrappingMetadata)
  );
}

export function targetEnvelopeMaterialEqual(
  left: DocumentContentKeyTargetEnvelope,
  right: DocumentContentKeyTargetEnvelope,
): boolean {
  return (
    targetKeyMaterialEqual(left, right) &&
    left.wrappedKey === right.wrappedKey &&
    canonicalJsonEquals(left.wrappingMetadata, right.wrappingMetadata)
  );
}

export function ensurePositiveContentKeyEpoch(contentKeyEpoch: number): void {
  if (!Number.isInteger(contentKeyEpoch) || contentKeyEpoch <= 0) {
    throw new DocumentContentKeyBundleError(
      "Document content key epoch must be a positive integer",
      400,
    );
  }
}

function assertNoDuplicateTargetContainers(
  targets: readonly DocumentContentKeyTargetEnvelope[],
): void {
  const targetContainerIds = targets.map((target) => target.containerId);
  if (new Set(targetContainerIds).size !== targetContainerIds.length) {
    throw new DocumentContentKeyBundleError(
      "Document content-key targets contain duplicate containers",
      409,
    );
  }
}

function assertWrappedMaterialPresent(
  targets: readonly DocumentContentKeyTargetEnvelope[],
): void {
  for (const target of targets) {
    if (target.wrappedKey.length === 0) {
      throw new DocumentContentKeyBundleError(
        "Document content-key target is missing wrapped key material",
        400,
      );
    }
  }
}

function expectedTargetMap(
  targets: readonly DocumentContentKeyTarget[],
): Map<string, DocumentContentKeyTarget> {
  return new Map(targets.map((target) => [targetKey(target), target]));
}

export function currentTargetsContainPreviousBundle(input: {
  readonly currentTargets: readonly DocumentContentKeyTarget[];
  readonly previousTargets: readonly DocumentContentKeyTargetEnvelope[];
}): boolean {
  const currentTargetByContainerId = expectedTargetMap(input.currentTargets);

  return input.previousTargets.every((previousTarget) => {
    const currentTarget = currentTargetByContainerId.get(
      previousTarget.containerId,
    );
    return (
      currentTarget !== undefined &&
      targetKeyMaterialEqual(previousTarget, currentTarget)
    );
  });
}

export function assertTargetsMatchCurrent(input: {
  readonly currentTargets: CurrentDocumentKekTargets;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}): void {
  assertNoDuplicateTargetContainers(input.targets);
  assertWrappedMaterialPresent(input.targets);

  const currentTargetByContainerId = expectedTargetMap(
    input.currentTargets.targets,
  );

  if (input.targets.length !== currentTargetByContainerId.size) {
    throw new DocumentContentKeyBundleError(
      "Document content-key targets do not match current KEK targets",
      409,
    );
  }

  for (const target of input.targets) {
    const currentTarget = currentTargetByContainerId.get(target.containerId);
    if (!currentTarget || !targetFieldsEqual(target, currentTarget)) {
      throw new DocumentContentKeyBundleError(
        "Document content-key targets do not match current KEK targets",
        409,
      );
    }
  }
}

export async function assertTargetHashMatches(input: {
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}): Promise<void> {
  try {
    const targetHash = await computeDocumentContentKeyTargetHash(
      input.targets.map(toTargetFields),
    );

    if (targetHash !== input.targetHash) {
      throw new DocumentContentKeyBundleError(
        "Document content-key target hash mismatch",
        409,
      );
    }
  } catch (error) {
    if (error instanceof DocumentContentKeyBundleError) {
      throw error;
    }
    if (error instanceof KeyingVerificationError) {
      throw new DocumentContentKeyBundleError(error.message, 409);
    }
    throw error;
  }
}
