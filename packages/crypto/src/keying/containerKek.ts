import { computeKeyingDomainHash } from "./canonical";
import type { KeyingCanonicalPayload } from "./canonicalJsonTypes";
import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import {
  computeContainerKekRecipientTargetHash,
  containerKekRecipientTargetKey,
  deriveContainerKekRecipientTargetsOrThrow,
} from "./containerKek/recipientTargets";
import {
  assertContainerKeyEpochManifestBinding,
  assertContainerKeyEpochMatchesManifest,
  assertContainerKeyEpochParentBinding,
} from "./containerKekEpochBinding";
import { resolveContainerKekParentBinding } from "./containerKekParent";
import type {
  ContainerKekParentBinding,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerKekState,
  VerifyContainerKekStateInput,
} from "./containerKekTypes";
import { makeVerifiedContainerKekState } from "./containerKekTypes";
import type { PrincipalPolicyAuthorization } from "./principalPolicyTypes";
import {
  assertExactKeys,
  normalizeKekRecipientKind,
  normalizeSortedUniqueArray,
  readHashString,
  readNullableString,
  readPositiveInteger,
  readString,
  runVerifier,
  throwVerification,
} from "./shared";
import type { KeyingVerificationResult } from "./verificationError";

function normalizeContainerKeyEpoch(value: unknown): ContainerKeyEpoch {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "containerId",
      "createdByEventHash",
      "createdByManifestHash",
      "id",
      "keyEpoch",
      "parentContainerKeyEpochId",
    ],
    "container key epoch",
  );

  return {
    id: readString(record, "id", "container key epoch"),
    containerId: readString(record, "containerId", "container key epoch"),
    keyEpoch: readPositiveInteger(record, "keyEpoch", "container key epoch"),
    accessManifestHash: readHashString(
      record,
      "accessManifestHash",
      "container key epoch",
    ),
    parentContainerKeyEpochId: readNullableString(
      record,
      "parentContainerKeyEpochId",
      "container key epoch",
    ),
    createdByEventHash: readHashString(
      record,
      "createdByEventHash",
      "container key epoch",
    ),
    createdByManifestHash: readHashString(
      record,
      "createdByManifestHash",
      "container key epoch",
    ),
  };
}

function normalizeContainerKeyWrap(value: unknown): ContainerKeyWrap {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "kemCipherText",
      "recipientId",
      "recipientKeyEpochId",
      "recipientKeyFingerprint",
      "recipientKind",
      "wrapManifestHash",
      "wrappedKey",
    ],
    "container key wrap",
  );

  return {
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "container key wrap",
    ),
    recipientKind: normalizeKekRecipientKind(
      record.recipientKind,
      "container key wrap",
    ),
    recipientId: readString(record, "recipientId", "container key wrap"),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container key wrap",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container key wrap",
    ),
    kemCipherText: readString(record, "kemCipherText", "container key wrap"),
    wrappedKey: readString(record, "wrappedKey", "container key wrap"),
    wrapManifestHash: readHashString(
      record,
      "wrapManifestHash",
      "container key wrap",
    ),
  };
}

function containerKeyWrapTarget(
  wrap: ContainerKeyWrap,
): ContainerKekRecipientTarget {
  return {
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
  };
}

function containerKeyWrapKey(wrap: ContainerKeyWrap): string {
  return `${wrap.containerKeyEpochId}:${containerKekRecipientTargetKey(containerKeyWrapTarget(wrap))}`;
}

export async function computeContainerKeyEpochHash(
  keyEpoch: ContainerKeyEpoch,
): Promise<string> {
  const payload: KeyingCanonicalPayload<ContainerKeyEpoch> =
    normalizeContainerKeyEpoch(keyEpoch);

  return computeKeyingDomainHash(
    "tearleads.keying.container-key-epoch",
    payload,
  );
}

function buildAuthorizedContainerManifestMap(input: {
  readonly current: VerifiedContainerAccessManifest;
  readonly history: readonly VerifiedContainerAccessManifest[];
  readonly keyEpochId: string;
}): Map<string, VerifiedContainerAccessManifest> {
  const manifestByHash = new Map<string, VerifiedContainerAccessManifest>();

  for (const manifest of [...input.history, input.current]) {
    if (manifest.state.containerId !== input.current.state.containerId) {
      throwVerification(
        "object_mismatch",
        "container KEK history contains the wrong container",
      );
    }

    if (manifestByHash.has(manifest.manifestHash)) {
      throwVerification(
        "duplicate_entry",
        "container KEK history contains a duplicate manifest",
      );
    }

    if (manifest.state.containerKeyEpochId === input.keyEpochId) {
      manifestByHash.set(manifest.manifestHash, manifest);
    }
  }

  return manifestByHash;
}

function deriveTargetsForWrapManifest(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentKekState: ContainerKekParentBinding | null;
  readonly principalPolicies: readonly PrincipalPolicyAuthorization[];
  readonly targetsByManifestHash: Map<string, ContainerKekRecipientTarget[]>;
  readonly userRecipientKeys: readonly ContainerUserRecipientKey[];
}): ContainerKekRecipientTarget[] {
  const cachedTargets = input.targetsByManifestHash.get(
    input.manifest.manifestHash,
  );

  if (cachedTargets) {
    return cachedTargets;
  }

  const targets = deriveContainerKekRecipientTargetsOrThrow({
    containerManifest: input.manifest,
    parentKekState: input.parentKekState,
    principalPolicies: input.principalPolicies,
    userRecipientKeys: input.userRecipientKeys,
  });
  input.targetsByManifestHash.set(input.manifest.manifestHash, targets);

  return targets;
}

function assertWrapJustifiedByTargets(input: {
  readonly wrap: ContainerKeyWrap;
  readonly targets: readonly ContainerKekRecipientTarget[];
}): void {
  const wrapTarget = containerKeyWrapTarget(input.wrap);
  const matchingTarget = input.targets.find(
    (target) =>
      containerKekRecipientTargetKey(target) ===
      containerKekRecipientTargetKey(wrapTarget),
  );

  if (!matchingTarget) {
    throwVerification(
      "missing_dependency",
      "container key wrap is not justified by its manifest",
    );
  }

  if (
    matchingTarget.recipientKeyFingerprint !==
    wrapTarget.recipientKeyFingerprint
  ) {
    throwVerification(
      "hash_mismatch",
      "container key wrap recipient fingerprint does not match justified target",
    );
  }
}

function verifyContainerKeyWraps(input: {
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifestByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
  readonly parentKekState: ContainerKekParentBinding | null;
  readonly principalPolicies: readonly PrincipalPolicyAuthorization[];
  readonly targetsByManifestHash: Map<string, ContainerKekRecipientTarget[]>;
  readonly userRecipientKeys: readonly ContainerUserRecipientKey[];
  readonly wraps: readonly ContainerKeyWrap[];
}): {
  readonly normalizedWraps: ContainerKeyWrap[];
  readonly wrapByTargetKey: Map<string, ContainerKeyWrap>;
} {
  const normalizedWraps = normalizeSortedUniqueArray(
    input.wraps,
    normalizeContainerKeyWrap,
    containerKeyWrapKey,
    "container key wraps",
  );
  const wrapByTargetKey = new Map<string, ContainerKeyWrap>();

  for (const wrap of normalizedWraps) {
    if (wrap.containerKeyEpochId !== input.keyEpoch.id) {
      throwVerification(
        "object_mismatch",
        "container key wrap belongs to the wrong key epoch",
      );
    }

    const wrapManifest = input.manifestByHash.get(wrap.wrapManifestHash);
    if (!wrapManifest) {
      throwVerification(
        "missing_dependency",
        "container key wrap manifest is not in verified history",
      );
    }

    const targets = deriveTargetsForWrapManifest({
      manifest: wrapManifest,
      parentKekState: input.parentKekState,
      principalPolicies: input.principalPolicies,
      targetsByManifestHash: input.targetsByManifestHash,
      userRecipientKeys: input.userRecipientKeys,
    });
    assertWrapJustifiedByTargets({ wrap, targets });

    wrapByTargetKey.set(
      containerKekRecipientTargetKey(containerKeyWrapTarget(wrap)),
      wrap,
    );
  }

  return { normalizedWraps, wrapByTargetKey };
}

function assertContainerKeyWrapsMatchTargets(input: {
  readonly recipientTargets: readonly ContainerKekRecipientTarget[];
  readonly wrapByTargetKey: ReadonlyMap<string, ContainerKeyWrap>;
}): void {
  for (const target of input.recipientTargets) {
    const wrap = input.wrapByTargetKey.get(
      containerKekRecipientTargetKey(target),
    );

    if (!wrap) {
      throwVerification(
        "missing_dependency",
        "container KEK state is missing a required key wrap",
      );
    }

    if (wrap.recipientKeyFingerprint !== target.recipientKeyFingerprint) {
      throwVerification(
        "hash_mismatch",
        "container key wrap recipient fingerprint does not match verified target",
      );
    }
  }

  if (input.wrapByTargetKey.size !== input.recipientTargets.length) {
    throwVerification(
      "missing_dependency",
      "container KEK state contains an extra key wrap",
    );
  }
}

async function buildVerifiedContainerKekState(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly normalizedWraps: readonly ContainerKeyWrap[];
  readonly recipientTargets: readonly ContainerKekRecipientTarget[];
}): Promise<VerifiedContainerKekState> {
  const state = {
    containerId: input.containerManifest.state.containerId,
    accessManifestHash: input.containerManifest.manifestHash,
    containerKeyEpochId: input.keyEpoch.id,
    containerKeyEpoch: input.keyEpoch.keyEpoch,
    keyEpoch: input.keyEpoch,
    keyEpochHash: await computeContainerKeyEpochHash(input.keyEpoch),
    parentContainerKeyEpochId: input.keyEpoch.parentContainerKeyEpochId,
    keyTargetHash: await computeContainerKekRecipientTargetHash(
      input.recipientTargets,
    ),
    recipientTargets: input.recipientTargets,
    wraps: input.normalizedWraps,
  };

  return makeVerifiedContainerKekState(state);
}

export async function verifyContainerKekState({
  allowHistoricalParentEpoch = false,
  containerManifest,
  containerManifestHistory = [],
  keyEpoch,
  parentKekState: currentParentKekState = null,
  parentManifestHistory,
  principalPolicies = [],
  userRecipientKeys = [],
  wraps,
}: VerifyContainerKekStateInput): Promise<
  KeyingVerificationResult<VerifiedContainerKekState>
> {
  return runVerifier(async () => {
    const normalizedKeyEpoch = normalizeContainerKeyEpoch(keyEpoch);
    await assertContainerKeyEpochMatchesManifest({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
    });

    const parentKekState = await resolveContainerKekParentBinding({
      parent: currentParentKekState,
      pinnedEpochId: normalizedKeyEpoch.parentContainerKeyEpochId,
      verifiedHistory: allowHistoricalParentEpoch
        ? parentManifestHistory
        : undefined,
    });
    assertContainerKeyEpochParentBinding({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
      parentKekState,
    });

    const manifestByHash = buildAuthorizedContainerManifestMap({
      current: containerManifest,
      history: containerManifestHistory,
      keyEpochId: normalizedKeyEpoch.id,
    });
    assertContainerKeyEpochManifestBinding({
      parentManifests: parentManifestHistory ?? [],
      keyEpoch: normalizedKeyEpoch,
      manifestByHash,
    });

    const recipientTargets = deriveContainerKekRecipientTargetsOrThrow({
      containerManifest,
      parentKekState,
      principalPolicies,
      userRecipientKeys,
    });
    const targetsByManifestHash = new Map<
      string,
      ContainerKekRecipientTarget[]
    >([[containerManifest.manifestHash, recipientTargets]]);
    const { normalizedWraps, wrapByTargetKey } = verifyContainerKeyWraps({
      keyEpoch: normalizedKeyEpoch,
      manifestByHash,
      parentKekState,
      principalPolicies,
      targetsByManifestHash,
      userRecipientKeys,
      wraps,
    });
    assertContainerKeyWrapsMatchTargets({
      recipientTargets,
      wrapByTargetKey,
    });

    return buildVerifiedContainerKekState({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
      normalizedWraps,
      recipientTargets,
    });
  });
}
