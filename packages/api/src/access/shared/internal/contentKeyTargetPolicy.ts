import {
  ContentKeyEnvelopeError,
  type ContentKeyEnvelopeOrigin,
  type ContentKeyEnvelopeSuite,
  decodeContentKeyEnvelope,
  type KeyingCanonicalJson,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { compareStrings } from "../../../utils/array";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";

interface ContentKeyTarget {
  readonly containerKeyEpoch: number;
  readonly containerKeyEpochId: string;
  readonly containerManifestHash: string;
}

interface WrappedContentKeyTargetEnvelope {
  readonly wrappedKey: string;
  readonly wrappingMetadata: KeyingCanonicalJson;
}

function sortContentKeyTargetEnvelopes<T>(
  targets: readonly T[],
  targetKey: (target: T) => string,
): T[] {
  return [...targets].sort((left, right) =>
    compareStrings(targetKey(left), targetKey(right)),
  );
}

function contentKeyTargetEnvelopeEqualBy<
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

/** Stored rows keep only this invariant; strict shape is a submission gate. */
function assertContentKeyWrappedMaterialPresent<
  T extends WrappedContentKeyTargetEnvelope,
>(targets: readonly T[], createError: () => Error): void {
  for (const target of targets) {
    if (target.wrappedKey.length === 0) {
      throw createError();
    }
  }
}

/** Where a target set came from; a submission is held to the strict shape. */
export type ContentKeyTargetOrigin = ContentKeyEnvelopeOrigin;

function expectedContentKeyTargetMap<T>(
  targets: readonly T[],
  targetKey: (target: T) => string,
): Map<string, T> {
  return new Map(targets.map((target) => [targetKey(target), target]));
}

function assertPositiveContentKeyEpoch(
  contentKeyEpoch: number,
  createError: () => Error,
): void {
  if (!Number.isInteger(contentKeyEpoch) || contentKeyEpoch <= 0) {
    throw createError();
  }
}

function assertContentKeyTargetsMatchCurrent<
  TCurrent,
  TEnvelope extends TCurrent & WrappedContentKeyTargetEnvelope,
>(input: {
  readonly currentTargets: readonly TCurrent[];
  readonly targets: readonly TEnvelope[];
  readonly targetKey: (target: TCurrent) => string;
  readonly targetFieldsEqual: (left: TCurrent, right: TCurrent) => boolean;
  readonly createDuplicateError: () => Error;
  readonly createMissingWrappedMaterialError: () => Error;
  readonly validateEnvelope: (
    envelope: WrappedContentKeyTargetEnvelope,
  ) => void;
  /**
   * Strict envelope shape is a submission gate, not a read gate. Applying it
   * while projecting rows already persisted would turn a malformed stored
   * envelope into a permanent, unhealable projection failure for that
   * document; the contract is that submissions are rejected before
   * persistence. Required rather than defaulted, so a new call site has to
   * state which it is instead of silently skipping the gate.
   *
   * A link mutation resubmits a retained wrap verbatim, so a stored envelope
   * does reach the submission gate there. That is sound rather than an
   * exemption to carve out: every envelope this deployment stores was written
   * through this gate by a producer that emits exactly `suite` and `iv`, so a
   * retained wrap is a conforming submission.
   */
  readonly origin: ContentKeyTargetOrigin;
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
  if (input.origin === "submission") {
    for (const target of input.targets) input.validateEnvelope(target);
  }

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

async function assertContentKeyTargetHashMatches<
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

interface ContentKeyTargetPolicyMessages {
  readonly duplicateTargets: string;
  readonly hashMismatch: string;
  readonly invalidEpoch: string;
  readonly missingWrappedMaterial: string;
  readonly targetsMismatch: string;
}

interface ContentKeyTargetPolicyOptions<
  TTarget extends ContentKeyTarget,
  TEnvelope extends TTarget & WrappedContentKeyTargetEnvelope,
> {
  readonly envelopeLabel: "Blob" | "Document";
  readonly wrappingSuite: ContentKeyEnvelopeSuite;
  readonly computeTargetHash: (targets: readonly TTarget[]) => Promise<string>;
  readonly createError: (message: string, status: 400 | 409) => Error;
  readonly messages: ContentKeyTargetPolicyMessages;
  readonly targetIdentityEqual: (left: TTarget, right: TTarget) => boolean;
  readonly targetKey: (target: TTarget) => string;
  readonly toTargetFields: (envelope: TEnvelope) => TTarget;
}

export function createContentKeyTargetPolicy<
  TTarget extends ContentKeyTarget,
  TEnvelope extends TTarget & WrappedContentKeyTargetEnvelope,
  TCurrentTargets extends { readonly targets: readonly TTarget[] },
>(options: ContentKeyTargetPolicyOptions<TTarget, TEnvelope>) {
  const targetKeyMaterialEqual = (left: TTarget, right: TTarget): boolean =>
    options.targetIdentityEqual(left, right) &&
    left.containerKeyEpochId === right.containerKeyEpochId &&
    left.containerKeyEpoch === right.containerKeyEpoch;

  const targetFieldsEqual = (left: TTarget, right: TTarget): boolean =>
    targetKeyMaterialEqual(left, right) &&
    left.containerManifestHash === right.containerManifestHash;

  const targetEnvelopeEqual = (left: TEnvelope, right: TEnvelope): boolean =>
    contentKeyTargetEnvelopeEqualBy(left, right, targetFieldsEqual);

  const targetEnvelopeMaterialEqual = (
    left: TEnvelope,
    right: TEnvelope,
  ): boolean =>
    contentKeyTargetEnvelopeEqualBy(left, right, targetKeyMaterialEqual);

  return {
    assertTargetHashMatches: async (input: {
      readonly targetHash: string;
      readonly targets: readonly TEnvelope[];
    }): Promise<void> => {
      await assertContentKeyTargetHashMatches({
        ...input,
        toTargetFields: options.toTargetFields,
        computeTargetHash: options.computeTargetHash,
        createHashMismatchError: () =>
          options.createError(options.messages.hashMismatch, 409),
        createVerificationError: (message) => options.createError(message, 409),
      });
    },
    assertTargetsMatchCurrent: (input: {
      readonly currentTargets: TCurrentTargets;
      readonly origin: ContentKeyTargetOrigin;
      readonly targets: readonly TEnvelope[];
    }): void => {
      assertContentKeyTargetsMatchCurrent({
        currentTargets: input.currentTargets.targets,
        targets: input.targets,
        targetKey: options.targetKey,
        targetFieldsEqual,
        origin: input.origin,
        createDuplicateError: () =>
          options.createError(options.messages.duplicateTargets, 409),
        createMissingWrappedMaterialError: () =>
          options.createError(options.messages.missingWrappedMaterial, 400),
        validateEnvelope: (envelope) => {
          try {
            decodeContentKeyEnvelope({
              envelope,
              label: options.envelopeLabel,
              origin: "submission",
              suite: options.wrappingSuite,
            });
          } catch (error) {
            if (error instanceof ContentKeyEnvelopeError)
              throw options.createError(error.message, 400);
            throw error;
          }
        },
        createMismatchError: () =>
          options.createError(options.messages.targetsMismatch, 409),
      });
    },
    ensurePositiveContentKeyEpoch: (contentKeyEpoch: number): void => {
      assertPositiveContentKeyEpoch(contentKeyEpoch, () =>
        options.createError(options.messages.invalidEpoch, 400),
      );
    },
    sortTargetEnvelopes: (targets: readonly TEnvelope[]): TEnvelope[] =>
      sortContentKeyTargetEnvelopes(targets, options.targetKey),
    targetEnvelopeEqual,
    targetEnvelopeMaterialEqual,
    targetKeyMaterialEqual,
  };
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
