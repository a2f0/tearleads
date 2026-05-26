import { bytesToBase64 } from "@tearleads/encoding";
import { isSha256HexString } from "@tearleads/validators/util";
import { normalizeReferencedPrincipalHead } from "./accessEvent";
import { computeKeyingDomainHash } from "./canonical";
import { principalPolicyMatchesReference } from "./containerAccess";
import { requireEventDependency } from "./documentAccess";
import {
  assertExactKeys,
  compareCanonicalStrings,
  normalizeKekRecipientKind,
  normalizeSortedUniqueArray,
  normalizeUniqueSortedStrings,
  ok,
  readHashString,
  readNullableString,
  readPositiveInteger,
  readString,
  readStringArray,
  readVersion,
  runVerifier,
  throwVerification,
  toVerificationResult,
} from "./shared";
import type {
  BlobAccessManifest,
  BlobContentKeyTarget,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerKekRecipientTarget,
  ContainerKekTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  DeriveBlobKekTargetsInput,
  DeriveContainerKekRecipientTargetsInput,
  DeriveDocumentKekTargetsInput,
  DocumentContentKeyTarget,
  KeyingCanonicalPayload,
  KeyingVerificationResult,
  ReferencedPrincipalHead,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
  VerifyContainerKekStateInput,
} from "./types";
import {
  CONTAINER_KEK_MATERIAL_ID_PREFIX,
  makeVerifiedBlobKekTargets,
  makeVerifiedContainerKekState,
  makeVerifiedDocumentKekTargets,
} from "./types";

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

export async function computeContainerKekMaterialId(input: {
  readonly containerId: string;
  readonly keyEpoch: number;
  readonly keyMaterial: Uint8Array;
}): Promise<`${typeof CONTAINER_KEK_MATERIAL_ID_PREFIX}${string}`> {
  if (input.keyMaterial.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }

  const materialHash = await computeKeyingDomainHash(
    "tearleads.keying.container-kek-material-id",
    {
      version: 1,
      containerId: input.containerId,
      keyEpoch: input.keyEpoch,
      keyMaterial: bytesToBase64(input.keyMaterial),
    },
  );
  return `${CONTAINER_KEK_MATERIAL_ID_PREFIX}${materialHash}`;
}

export function isContainerKekMaterialId(value: string): boolean {
  if (!value.startsWith(CONTAINER_KEK_MATERIAL_ID_PREFIX)) {
    return false;
  }

  return isSha256HexString(
    value.slice(CONTAINER_KEK_MATERIAL_ID_PREFIX.length),
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
    recipientKind: referencedHead.principalType,
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

function normalizeContainerKekTarget(
  value: unknown,
  label: string,
): ContainerKekTarget {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpoch",
      "containerKeyEpochId",
      "containerManifestHash",
    ],
    label,
  );

  return {
    containerId: readString(record, "containerId", label),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      label,
    ),
    containerKeyEpochId: readString(record, "containerKeyEpochId", label),
    containerKeyEpoch: readPositiveInteger(record, "containerKeyEpoch", label),
  };
}

function containerKekTargetKey(target: ContainerKekTarget): string {
  return `${target.containerId}:${target.containerKeyEpochId}`;
}

function normalizeBlobContentKeyTarget(value: unknown): BlobContentKeyTarget {
  const record = assertExactKeys(
    value,
    [
      "bindingId",
      "containerId",
      "containerKeyEpoch",
      "containerKeyEpochId",
      "containerManifestHash",
      "documentId",
    ],
    "blob content-key target",
  );

  return {
    containerId: readString(record, "containerId", "blob content-key target"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "blob content-key target",
    ),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "blob content-key target",
    ),
    containerKeyEpoch: readPositiveInteger(
      record,
      "containerKeyEpoch",
      "blob content-key target",
    ),
    bindingId: readString(record, "bindingId", "blob content-key target"),
    documentId: readString(record, "documentId", "blob content-key target"),
  };
}

function blobContentKeyTargetKey(target: BlobContentKeyTarget): string {
  return `${target.bindingId}:${target.documentId}:${containerKekTargetKey(target)}`;
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

export async function computeDocumentContentKeyTargetHash(
  targets: readonly DocumentContentKeyTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    (target) =>
      normalizeContainerKekTarget(target, "document content-key target"),
    containerKekTargetKey,
    "document content-key targets",
  );
  const payload: KeyingCanonicalPayload<readonly DocumentContentKeyTarget[]> =
    normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.document-content-key-targets",
    payload,
  );
}

function uniqueContainerManifestMap(
  manifests: readonly VerifiedContainerAccessManifest[],
): Map<string, VerifiedContainerAccessManifest> {
  const manifestByContainerId = new Map<
    string,
    VerifiedContainerAccessManifest
  >();

  for (const containerManifest of manifests) {
    if (manifestByContainerId.has(containerManifest.state.containerId)) {
      throwVerification(
        "duplicate_entry",
        "document KEK target derivation contains a duplicate container manifest",
      );
    }
    manifestByContainerId.set(
      containerManifest.state.containerId,
      containerManifest,
    );
  }

  return manifestByContainerId;
}

function uniqueContainerKekStateMap(
  states: readonly VerifiedContainerKekState[],
): Map<string, VerifiedContainerKekState> {
  const kekStateByContainerId = new Map<string, VerifiedContainerKekState>();

  for (const kekState of states) {
    if (kekStateByContainerId.has(kekState.containerId)) {
      throwVerification(
        "duplicate_entry",
        "document KEK target derivation contains a duplicate container KEK state",
      );
    }
    kekStateByContainerId.set(kekState.containerId, kekState);
  }

  return kekStateByContainerId;
}

function deriveLinkedDocumentKekTarget(input: {
  readonly containerId: string;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly manifestByContainerId: ReadonlyMap<
    string,
    VerifiedContainerAccessManifest
  >;
  readonly kekStateByContainerId: ReadonlyMap<
    string,
    VerifiedContainerKekState
  >;
}): DocumentContentKeyTarget {
  const containerManifest = input.manifestByContainerId.get(input.containerId);
  const kekState = input.kekStateByContainerId.get(input.containerId);

  if (!containerManifest || !kekState) {
    throwVerification(
      "missing_dependency",
      "document KEK target derivation is missing a linked container target",
    );
  }

  if (
    containerManifest.state.organizationId !==
      input.documentManifest.state.organizationId ||
    kekState.containerId !== input.containerId
  ) {
    throwVerification(
      "object_mismatch",
      "document KEK target belongs to the wrong document organization or container",
    );
  }

  if (kekState.accessManifestHash !== containerManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "document KEK target container manifest is stale",
    );
  }

  if (
    containerManifest.state.containerKeyEpochId === null ||
    kekState.containerKeyEpochId !== containerManifest.state.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "document KEK target container key epoch does not match the manifest",
    );
  }

  return {
    containerId: input.containerId,
    containerManifestHash: containerManifest.manifestHash,
    containerKeyEpochId: kekState.containerKeyEpochId,
    containerKeyEpoch: kekState.containerKeyEpoch,
  };
}

async function buildVerifiedDocumentKekTargets(input: {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly targets: readonly DocumentContentKeyTarget[];
}): Promise<VerifiedDocumentKekTargets> {
  const targets = {
    documentId: input.documentManifest.state.documentId,
    linkSetManifestHash: input.documentManifest.manifestHash,
    linkedContainerManifestHashes: input.targets.map(
      (target) => target.containerManifestHash,
    ),
    linkedContainerKeyEpochIds: input.targets.map(
      (target) => target.containerKeyEpochId,
    ),
    targets: input.targets,
    documentKeyTargetHash: await computeDocumentContentKeyTargetHash(
      input.targets,
    ),
  };

  return makeVerifiedDocumentKekTargets(targets);
}

export async function deriveDocumentKekTargets({
  containerKekStates,
  documentManifest,
  linkedContainerManifests,
}: DeriveDocumentKekTargetsInput): Promise<
  KeyingVerificationResult<VerifiedDocumentKekTargets>
> {
  return runVerifier(async () => {
    const manifestByContainerId = uniqueContainerManifestMap(
      linkedContainerManifests,
    );
    const kekStateByContainerId =
      uniqueContainerKekStateMap(containerKekStates);

    const normalizedTargets = normalizeSortedUniqueArray(
      documentManifest.state.linkedContainerIds.map((containerId) =>
        deriveLinkedDocumentKekTarget({
          containerId,
          documentManifest,
          manifestByContainerId,
          kekStateByContainerId,
        }),
      ),
      (target) =>
        normalizeContainerKekTarget(target, "document content-key target"),
      containerKekTargetKey,
      "document content-key targets",
    );

    return buildVerifiedDocumentKekTargets({
      documentManifest,
      targets: normalizedTargets,
    });
  });
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function uniqueDocumentManifestMap(
  manifests: readonly VerifiedDocumentLinkSetManifest[],
): Map<string, VerifiedDocumentLinkSetManifest> {
  const manifestByDocumentId = new Map<
    string,
    VerifiedDocumentLinkSetManifest
  >();

  for (const documentManifest of manifests) {
    if (manifestByDocumentId.has(documentManifest.state.documentId)) {
      throwVerification(
        "duplicate_entry",
        "blob KEK target derivation contains a duplicate document manifest",
      );
    }
    manifestByDocumentId.set(
      documentManifest.state.documentId,
      documentManifest,
    );
  }

  return manifestByDocumentId;
}

function normalizeActiveAttachmentBindings(input: {
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
}): VerifiedAttachmentBinding[] {
  if (input.activeBindings.length === 0) {
    throwVerification(
      "missing_dependency",
      "blob KEK target derivation requires an active attachment binding",
    );
  }

  const normalizedBindings = [...input.activeBindings].sort((left, right) =>
    compareCanonicalStrings(left.bindingId, right.bindingId),
  );

  let previousBindingId: string | null = null;
  for (const binding of normalizedBindings) {
    if (binding.blobId !== input.blobId) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding targets the wrong blob",
      );
    }

    if (
      binding.body.bindingId !== binding.bindingId ||
      binding.body.blobId !== binding.blobId ||
      binding.body.documentId !== binding.documentId ||
      binding.body.slotId !== binding.slotId ||
      binding.body.documentManifestHash !== binding.documentManifestHash
    ) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding body does not match projection",
      );
    }

    if (binding.event.event.objectKind !== "blob") {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding event must target a blob",
      );
    }

    if (
      binding.event.event.eventType !== "attachment.bind" ||
      binding.event.event.objectId !== input.blobId
    ) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding event does not match blob",
      );
    }

    if (previousBindingId === binding.bindingId) {
      throwVerification(
        "duplicate_entry",
        "blob KEK target derivation contains a duplicate attachment binding",
      );
    }
    previousBindingId = binding.bindingId;
  }

  return normalizedBindings;
}

function requireDocumentManifestForBinding(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly documentManifestById: ReadonlyMap<
    string,
    VerifiedDocumentLinkSetManifest
  >;
}): VerifiedDocumentLinkSetManifest {
  const documentManifest = input.documentManifestById.get(
    input.binding.documentId,
  );

  if (!documentManifest) {
    throwVerification(
      "missing_dependency",
      "blob KEK target derivation is missing a binding document manifest",
    );
  }

  if (
    documentManifest.state.organizationId !==
    input.binding.event.event.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "blob KEK target derivation document manifest belongs to the wrong organization",
    );
  }

  requireEventDependency({
    event: input.binding.event,
    manifestHash: input.binding.documentManifestHash,
    label: "blob KEK target derivation attachment binding",
  });

  return documentManifest;
}

async function deriveBlobKekTargetsForBinding(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly containerKekStates: readonly VerifiedContainerKekState[];
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
}): Promise<BlobContentKeyTarget[]> {
  const documentTargets = await deriveDocumentKekTargets({
    documentManifest: input.documentManifest,
    linkedContainerManifests: input.linkedContainerManifests,
    containerKekStates: input.containerKekStates,
  });

  if (!documentTargets.ok) {
    throw documentTargets.error;
  }

  return documentTargets.value.targets.map((target) => ({
    ...target,
    bindingId: input.binding.bindingId,
    documentId: input.binding.documentId,
  }));
}

async function buildVerifiedBlobKekTargets(input: {
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly documentManifests: readonly VerifiedDocumentLinkSetManifest[];
  readonly targets: readonly BlobContentKeyTarget[];
}): Promise<VerifiedBlobKekTargets> {
  const organizationIds = uniqueSortedStrings(
    input.documentManifests.map((manifest) => manifest.state.organizationId),
  );
  const organizationId = organizationIds[0];
  if (!organizationId || organizationIds.length !== 1) {
    throwVerification(
      "object_mismatch",
      "blob KEK target derivation must stay within one organization",
    );
  }
  const blobKeyTargetHash = await computeBlobContentKeyTargetHash(
    input.targets,
  );
  const blobAccessManifestHash = await computeBlobAccessManifestHash({
    version: 1,
    blobId: input.blobId,
    organizationId,
    activeBindingIds: input.activeBindings.map((binding) => binding.bindingId),
    documentManifestHashes: uniqueSortedStrings(
      input.documentManifests.map((manifest) => manifest.manifestHash),
    ),
    linkedContainerManifestHashes: uniqueSortedStrings(
      input.targets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      input.targets.map((target) => target.containerKeyEpochId),
    ),
    blobKeyTargetHash,
  });

  const targets = {
    blobId: input.blobId,
    organizationId,
    activeBindingIds: input.activeBindings.map((binding) => binding.bindingId),
    documentManifestHashes: uniqueSortedStrings(
      input.documentManifests.map((manifest) => manifest.manifestHash),
    ),
    linkedContainerManifestHashes: uniqueSortedStrings(
      input.targets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      input.targets.map((target) => target.containerKeyEpochId),
    ),
    targets: input.targets,
    blobKeyTargetHash,
    blobAccessManifestHash,
  };

  return makeVerifiedBlobKekTargets(targets);
}

export async function deriveBlobKekTargets({
  activeBindings,
  blobId,
  containerKekStates,
  documentManifests,
  linkedContainerManifests,
}: DeriveBlobKekTargetsInput): Promise<
  KeyingVerificationResult<VerifiedBlobKekTargets>
> {
  return runVerifier(async () => {
    const normalizedBindings = normalizeActiveAttachmentBindings({
      activeBindings,
      blobId,
    });
    const documentManifestById = uniqueDocumentManifestMap(documentManifests);
    const targets: BlobContentKeyTarget[] = [];

    for (const binding of normalizedBindings) {
      const documentManifest = requireDocumentManifestForBinding({
        binding,
        documentManifestById,
      });
      targets.push(
        ...(await deriveBlobKekTargetsForBinding({
          binding,
          documentManifest,
          linkedContainerManifests,
          containerKekStates,
        })),
      );
    }

    const normalizedTargets = normalizeSortedUniqueArray(
      targets,
      normalizeBlobContentKeyTarget,
      blobContentKeyTargetKey,
      "blob content-key targets",
    );

    return buildVerifiedBlobKekTargets({
      activeBindings: normalizedBindings,
      blobId,
      documentManifests: normalizedBindings.map((binding) =>
        requireDocumentManifestForBinding({ binding, documentManifestById }),
      ),
      targets: normalizedTargets,
    });
  });
}

export async function computeBlobContentKeyTargetHash(
  targets: readonly BlobContentKeyTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    normalizeBlobContentKeyTarget,
    blobContentKeyTargetKey,
    "blob content-key targets",
  );
  const payload: KeyingCanonicalPayload<readonly BlobContentKeyTarget[]> =
    normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.blob-content-key-targets",
    payload,
  );
}

function normalizeHashStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const values = normalizeUniqueSortedStrings(
    readStringArray(record, key, label),
    `${label}.${key}`,
  );

  for (const [index, value] of values.entries()) {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throwVerification(
        "hash_mismatch",
        `${label}.${key}[${index}] must be a 64-character lowercase hex hash`,
      );
    }
  }

  return values;
}

function normalizeBlobAccessManifest(value: unknown): BlobAccessManifest {
  const record = assertExactKeys(
    value,
    [
      "activeBindingIds",
      "blobId",
      "blobKeyTargetHash",
      "documentManifestHashes",
      "linkedContainerKeyEpochIds",
      "linkedContainerManifestHashes",
      "organizationId",
      "version",
    ],
    "blob access manifest",
  );

  return {
    version: readVersion(record, "blob access manifest"),
    blobId: readString(record, "blobId", "blob access manifest"),
    organizationId: readString(
      record,
      "organizationId",
      "blob access manifest",
    ),
    activeBindingIds: normalizeUniqueSortedStrings(
      readStringArray(record, "activeBindingIds", "blob access manifest"),
      "blob access manifest.activeBindingIds",
    ),
    documentManifestHashes: normalizeHashStringArray(
      record,
      "documentManifestHashes",
      "blob access manifest",
    ),
    linkedContainerManifestHashes: normalizeHashStringArray(
      record,
      "linkedContainerManifestHashes",
      "blob access manifest",
    ),
    linkedContainerKeyEpochIds: normalizeUniqueSortedStrings(
      readStringArray(
        record,
        "linkedContainerKeyEpochIds",
        "blob access manifest",
      ),
      "blob access manifest.linkedContainerKeyEpochIds",
    ),
    blobKeyTargetHash: readHashString(
      record,
      "blobKeyTargetHash",
      "blob access manifest",
    ),
  };
}

export async function computeBlobAccessManifestHash(
  manifest: BlobAccessManifest,
): Promise<string> {
  const payload: KeyingCanonicalPayload<BlobAccessManifest> =
    normalizeBlobAccessManifest(manifest);

  return computeKeyingDomainHash(
    "tearleads.keying.blob-access-manifest",
    payload,
  );
}
