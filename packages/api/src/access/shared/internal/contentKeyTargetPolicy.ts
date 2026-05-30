import type { KeyingCanonicalJson } from "@tearleads/crypto";
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

export function contentKeyTargetEnvelopeEqual<
  T extends WrappedContentKeyTargetEnvelope,
>(
  left: T,
  right: T,
  targetFieldsEqual: (left: T, right: T) => boolean,
): boolean {
  return (
    targetFieldsEqual(left, right) &&
    left.wrappedKey === right.wrappedKey &&
    canonicalJsonEquals(left.wrappingMetadata, right.wrappingMetadata)
  );
}

export function contentKeyTargetEnvelopeMaterialEqual<
  T extends WrappedContentKeyTargetEnvelope,
>(
  left: T,
  right: T,
  targetKeyMaterialEqual: (left: T, right: T) => boolean,
): boolean {
  return (
    targetKeyMaterialEqual(left, right) &&
    left.wrappedKey === right.wrappedKey &&
    canonicalJsonEquals(left.wrappingMetadata, right.wrappingMetadata)
  );
}

export function assertNoDuplicateContentKeyTargets<T>(
  targets: readonly T[],
  targetKey: (target: T) => string,
  createError: () => Error,
): void {
  const targetKeys = targets.map(targetKey);
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw createError();
  }
}

export function assertContentKeyWrappedMaterialPresent<
  T extends WrappedContentKeyTargetEnvelope,
>(targets: readonly T[], createError: () => Error): void {
  for (const target of targets) {
    if (target.wrappedKey.length === 0) {
      throw createError();
    }
  }
}

export function expectedContentKeyTargetMap<T>(
  targets: readonly T[],
  targetKey: (target: T) => string,
): Map<string, T> {
  return new Map(targets.map((target) => [targetKey(target), target]));
}
