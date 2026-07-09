import {
  type KeyingCanonicalJson,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { compareStrings } from "../../../utils/array";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";

interface WrappedContentKeyTargetEnvelope {
  readonly wrappedKey: string;
  readonly wrappingMetadata: KeyingCanonicalJson;
}

export function sortContentKeyTargetEnvelopes<T>(
  targets: readonly T[],
  targetKey: (target: T) => string,
): T[] {
  return [...targets].sort((left, right) =>
    compareStrings(targetKey(left), targetKey(right)),
  );
}

export function contentKeyTargetEnvelopeEqualBy<
  T extends WrappedContentKeyTargetEnvelope,
>(left: T, right: T, targetsEqual: (left: T, right: T) => boolean): boolean {
  return (
    targetsEqual(left, right) &&
    left.wrappedKey === right.wrappedKey &&
    canonicalJsonEquals(left.wrappingMetadata, right.wrappingMetadata)
  );
}

function assertNoDuplicateContentKeyTargets<T>(
  targets: readonly T[],
  targetKey: (target: T) => string,
  createError: () => Error,
): void {
  const targetKeys = targets.map(targetKey);
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw createError();
  }
}

function assertContentKeyWrappedMaterialPresent<
  T extends WrappedContentKeyTargetEnvelope,
>(targets: readonly T[], createError: () => Error): void {
  for (const target of targets) {
    if (target.wrappedKey.length === 0) {
      throw createError();
    }
  }
}

function expectedContentKeyTargetMap<T>(
  targets: readonly T[],
  targetKey: (target: T) => string,
): Map<string, T> {
  return new Map(targets.map((target) => [targetKey(target), target]));
}

export function assertPositiveContentKeyEpoch(
  contentKeyEpoch: number,
  createError: () => Error,
): void {
  if (!Number.isInteger(contentKeyEpoch) || contentKeyEpoch <= 0) {
    throw createError();
  }
}

export function assertContentKeyTargetsMatchCurrent<
  TCurrent,
  TEnvelope extends TCurrent & WrappedContentKeyTargetEnvelope,
>(input: {
  readonly currentTargets: readonly TCurrent[];
  readonly targets: readonly TEnvelope[];
  readonly targetKey: (target: TCurrent) => string;
  readonly targetFieldsEqual: (left: TCurrent, right: TCurrent) => boolean;
  readonly createDuplicateError: () => Error;
  readonly createMissingWrappedMaterialError: () => Error;
  readonly createMismatchError: () => Error;
}): void {
  assertNoDuplicateContentKeyTargets(
    input.targets,
    input.targetKey,
    input.createDuplicateError,
  );
  assertContentKeyWrappedMaterialPresent(
    input.targets,
    input.createMissingWrappedMaterialError,
  );

  const currentTargetByKey = expectedContentKeyTargetMap(
    input.currentTargets,
    input.targetKey,
  );

  if (input.targets.length !== currentTargetByKey.size) {
    throw input.createMismatchError();
  }

  for (const target of input.targets) {
    const currentTarget = currentTargetByKey.get(input.targetKey(target));
    if (!currentTarget || !input.targetFieldsEqual(target, currentTarget)) {
      throw input.createMismatchError();
    }
  }
}

export async function assertContentKeyTargetHashMatches<
  TTarget,
  TEnvelope extends TTarget,
>(input: {
  readonly targetHash: string;
  readonly targets: readonly TEnvelope[];
  readonly toTargetFields: (envelope: TEnvelope) => TTarget;
  readonly computeTargetHash: (targets: readonly TTarget[]) => Promise<string>;
  readonly createHashMismatchError: () => Error;
  readonly createVerificationError: (message: string) => Error;
}): Promise<void> {
  let targetHash: string;
  try {
    targetHash = await input.computeTargetHash(
      input.targets.map(input.toTargetFields),
    );
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw input.createVerificationError(error.message);
    }
    throw error;
  }

  if (targetHash !== input.targetHash) {
    throw input.createHashMismatchError();
  }
}

export async function assertExpectedTargetHashCurrent<T>(input: {
  readonly currentTargetHash: string;
  readonly expectedTargetHash?: string | undefined;
  readonly expectedTargets?: readonly T[] | undefined;
  readonly computeTargetHash: (targets: readonly T[]) => Promise<string>;
  readonly createRequiredError: () => Error;
  readonly createStaleError: () => Error;
}): Promise<void> {
  const expectedTargetHash =
    input.expectedTargetHash ??
    (input.expectedTargets
      ? await input.computeTargetHash(input.expectedTargets)
      : null);

  if (!expectedTargetHash) {
    throw input.createRequiredError();
  }

  if (expectedTargetHash !== input.currentTargetHash) {
    throw input.createStaleError();
  }
}
