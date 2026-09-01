import { normalizeReferencedPrincipalHead } from "./accessEvent";
import { computeKeyingDomainHash } from "./canonical";
import { principalPolicyMatchesReference } from "./containerAccess";
import { isContainerKekMaterialId } from "./containerKekMaterial";
import {
  assertExactKeys,
  normalizeKekRecipientKind,
  normalizeSortedUniqueArray,
  ok,
  readHashString,
  readNullableString,
  readPositiveInteger,
  readString,
  runVerifier,
  throwVerification,
  toVerificationResult,
} from "./shared";
import type {
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  DeriveContainerKekRecipientTargetsInput,
  KeyingCanonicalPayload,
  KeyingVerificationResult,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
  VerifyContainerKekStateInput,
} from "./types";
import { makeVerifiedContainerKekState } from "./types";

export {
  computeContainerKekMaterialId,
  isContainerKekMaterialId,
} from "./containerKekMaterial";

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

function normalizeContainerUserRecipientKey(
  value: unknown,
): ContainerUserRecipientKey {
  const record = assertExactKeys(
    value,
    ["recipientKeyEpochId", "recipientKeyFingerprint", "userId"],
    "container user recipient key",
  );

  return {
    userId: readString(record, "userId", "container user recipient key"),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container user recipient key",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container user recipient key",
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

export function derivePrincipalRecipientKeyEpochId(
  reference: ReferencedPrincipalHead,
): string {
  const normalizedReference = normalizeReferencedPrincipalHead(reference);

  return [
    normalizedReference.principalType,
    normalizedReference.principalId,
    normalizedReference.keyEpoch,
    normalizedReference.stateHash,
  ].join(":");
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

function buildContainerUserRecipientKeyMap(
  userRecipientKeys: readonly ContainerUserRecipientKey[],
): Map<string, ContainerUserRecipientKey> {
  const userKeyByUserId = new Map<string, ContainerUserRecipientKey>();

  for (const userKey of userRecipientKeys.map(
    normalizeContainerUserRecipientKey,
  )) {
    if (userKeyByUserId.has(userKey.userId)) {
      throwVerification(
        "duplicate_entry",
        "container user recipient keys contain a duplicate user",
      );
    }

    userKeyByUserId.set(userKey.userId, userKey);
  }

  return userKeyByUserId;
}

function requirePrincipalRecipientTarget(input: {
  readonly grant: ContainerDirectGrant;
  readonly state: ContainerAccessManifestState;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): ContainerKekRecipientTarget {
  if (input.grant.subjectType === "user") {
    throwVerification(
      "invalid_domain",
      "user grants do not have principal recipient targets",
    );
  }

  const referencedHead = input.state.referencedPrincipalHeads.find(
    (principalHead) =>
      principalHead.principalType === input.grant.subjectType &&
      principalHead.principalId === input.grant.subjectId,
  );

  if (!referencedHead) {
    throwVerification(
      "missing_dependency",
      "container KEK target derivation requires a referenced principal head",
    );
  }

  const verifiedPolicy = input.principalPolicies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference: referencedHead }),
  );

  if (!verifiedPolicy) {
    throwVerification(
      "missing_dependency",
      "container KEK target derivation requires the verified principal policy",
    );
  }

  return {
    recipientKind: "group",
    recipientId: referencedHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(referencedHead),
    recipientKeyFingerprint: referencedHead.keyFingerprint,
  };
}

function deriveContainerKekRecipientTargetsOrThrow({
  containerManifest,
  parentKekState = null,
  principalPolicies = [],
  userRecipientKeys = [],
}: DeriveContainerKekRecipientTargetsInput): ContainerKekRecipientTarget[] {
  const targets: ContainerKekRecipientTarget[] = [];
  const userKeyByUserId = buildContainerUserRecipientKeyMap(userRecipientKeys);

  for (const grant of containerManifest.state.directGrants) {
    if (grant.subjectType === "user") {
      const userKey = userKeyByUserId.get(grant.subjectId);

      if (!userKey) {
        throwVerification(
          "missing_dependency",
          "container KEK target derivation requires a user recipient key",
        );
      }

      targets.push({
        recipientKind: "user",
        recipientId: grant.subjectId,
        recipientKeyEpochId: userKey.recipientKeyEpochId,
        recipientKeyFingerprint: userKey.recipientKeyFingerprint,
      });
      continue;
    }

    targets.push(
      requirePrincipalRecipientTarget({
        grant,
        state: containerManifest.state,
        principalPolicies,
      }),
    );
  }

  if (containerManifest.state.parentContainerId) {
    if (!parentKekState) {
      throwVerification(
        "missing_dependency",
        "container KEK target derivation requires verified parent KEK state",
      );
    }

    if (
      parentKekState.containerId !== containerManifest.state.parentContainerId
    ) {
      throwVerification(
        "object_mismatch",
        "container KEK parent target points at the wrong parent container",
      );
    }

    targets.push({
      recipientKind: "container",
      recipientId: parentKekState.containerId,
      recipientKeyEpochId: parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: parentKekState.keyEpochHash,
    });
  }

  return normalizeSortedUniqueArray(
    targets,
    normalizeContainerKekRecipientTarget,
    containerKekRecipientTargetKey,
    "container KEK recipient targets",
  );
}

export function deriveContainerKekRecipientTargets(
  input: DeriveContainerKekRecipientTargetsInput,
): KeyingVerificationResult<readonly ContainerKekRecipientTarget[]> {
  try {
    return ok(deriveContainerKekRecipientTargetsOrThrow(input));
  } catch (error) {
    return toVerificationResult(error);
  }
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

function assertContainerKeyEpochManifestBinding(input: {
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifestByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  const accessManifest = input.manifestByHash.get(
    input.keyEpoch.accessManifestHash,
  );
  const createdByManifest = input.manifestByHash.get(
    input.keyEpoch.createdByManifestHash,
  );

  if (!accessManifest || !createdByManifest) {
    throwVerification(
      "missing_dependency",
      "container key epoch requires verified creation manifest history",
    );
  }

  if (createdByManifest.event.eventHash !== input.keyEpoch.createdByEventHash) {
    throwVerification(
      "hash_mismatch",
      "container key epoch created-by event hash does not match manifest",
    );
  }
}

function assertContainerKeyEpochParentBinding(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly parentKekState: VerifiedContainerKekState | null | undefined;
}): void {
  if (!input.containerManifest.state.parentContainerId) {
    if (input.keyEpoch.parentContainerKeyEpochId !== null) {
      throwVerification(
        "object_mismatch",
        "root container key epoch must not name a parent key epoch",
      );
    }

    return;
  }

  if (!input.parentKekState) {
    throwVerification(
      "missing_dependency",
      "container key epoch requires verified parent KEK state",
    );
  }

  if (
    input.parentKekState.containerId !==
    input.containerManifest.state.parentContainerId
  ) {
    throwVerification(
      "object_mismatch",
      "container key epoch parent state is for the wrong container",
    );
  }

  if (
    input.keyEpoch.parentContainerKeyEpochId !==
    input.parentKekState.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container key epoch parent edge points at the wrong parent key epoch",
    );
  }
}

function deriveTargetsForWrapManifest(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
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

function assertContainerKeyEpochMatchesManifest(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
}): void {
  const containerKeyEpochId = input.containerManifest.state.containerKeyEpochId;

  if (containerKeyEpochId === null) {
    throwVerification(
      "missing_dependency",
      "container KEK state requires a container key epoch id",
    );
  }

  if (!isContainerKekMaterialId(containerKeyEpochId)) {
    throwVerification(
      "invalid_shape",
      "container KEK state requires a material-committing container key epoch id",
    );
  }

  if (input.keyEpoch.id !== containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container KEK state does not match the current access manifest",
    );
  }

  if (
    input.keyEpoch.containerId !== input.containerManifest.state.containerId
  ) {
    throwVerification(
      "object_mismatch",
      "container key epoch belongs to the wrong container",
    );
  }
}

function verifyContainerKeyWraps(input: {
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifestByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
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
  containerManifest,
  containerManifestHistory = [],
  keyEpoch,
  parentKekState = null,
  principalPolicies = [],
  userRecipientKeys = [],
  wraps,
}: VerifyContainerKekStateInput): Promise<
  KeyingVerificationResult<VerifiedContainerKekState>
> {
  return runVerifier(async () => {
    const normalizedKeyEpoch = normalizeContainerKeyEpoch(keyEpoch);
    assertContainerKeyEpochMatchesManifest({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
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

function normalizeContainerKekRecipientTarget(
  value: unknown,
): ContainerKekRecipientTarget {
  const record = assertExactKeys(
    value,
    [
      "recipientId",
      "recipientKeyEpochId",
      "recipientKeyFingerprint",
      "recipientKind",
    ],
    "container KEK recipient target",
  );

  return {
    recipientKind: normalizeKekRecipientKind(
      record.recipientKind,
      "container KEK recipient target",
    ),
    recipientId: readString(
      record,
      "recipientId",
      "container KEK recipient target",
    ),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container KEK recipient target",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container KEK recipient target",
    ),
  };
}

function containerKekRecipientTargetKey(
  target: ContainerKekRecipientTarget,
): string {
  return `${target.recipientKind}:${target.recipientId}:${target.recipientKeyEpochId}`;
}

export async function computeContainerKekRecipientTargetHash(
  targets: readonly ContainerKekRecipientTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    normalizeContainerKekRecipientTarget,
    containerKekRecipientTargetKey,
    "container KEK recipient targets",
  );
  const payload: KeyingCanonicalPayload<
    readonly ContainerKekRecipientTarget[]
  > = normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.container-kek-recipient-targets",
    payload,
  );
}

export {
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  computeDocumentContentKeyTargetHash,
  deriveBlobKekTargets,
  deriveDocumentKekTargets,
} from "./containerKek/contentKeyTargets";
