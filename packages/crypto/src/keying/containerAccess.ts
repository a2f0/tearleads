import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  computeAccessManifestHash,
  normalizeReferencedPrincipalHead,
  normalizeReferencedPrincipalHeads,
  referencedPrincipalKey,
  verifyAccessManifest,
} from "./accessEvent";
import { computeKeyingDomainHash } from "./canonical";
import {
  assertExactKeys,
  normalizeContainerAccessLevel,
  normalizeContainerGrantSubjectType,
  normalizeSortedUniqueArray,
  readHashString,
  readNullableHashString,
  readNullableString,
  readPositiveInteger,
  readString,
  readVersion,
  runVerifier,
  throwVerification,
} from "./shared";
import type {
  AccessManifest,
  ContainerAccessEventBody,
  ContainerAccessKeyState,
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerAccessMetadata,
  ContainerAccessStructural,
  ContainerCreateAccessEventBody,
  ContainerDirectGrant,
  ContainerGrantAccessEventBody,
  ContainerMoveAccessEventBody,
  ContainerRekeyAccessEventBody,
  ContainerRevokeAccessEventBody,
  KeyingCanonicalJson,
  KeyingCanonicalPayload,
  KeyingVerificationResult,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
  VerifyContainerAccessManifestInput,
} from "./types";
import { makeVerifiedContainerAccessManifest } from "./types";

export function containerAccessLevelRank(
  accessLevel: ContainerAccessLevel,
): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

function mergeContainerAccessLevel(
  current: ContainerAccessLevel | null,
  incoming: ContainerAccessLevel,
): ContainerAccessLevel {
  if (
    current === null ||
    containerAccessLevelRank(incoming) > containerAccessLevelRank(current)
  ) {
    return incoming;
  }

  return current;
}

function normalizeContainerDirectGrant(value: unknown): ContainerDirectGrant {
  const record = assertExactKeys(
    value,
    ["accessLevel", "subjectId", "subjectType"],
    "container direct grant",
  );

  return {
    accessLevel: normalizeContainerAccessLevel(
      record.accessLevel,
      "container direct grant",
    ),
    subjectId: readString(record, "subjectId", "container direct grant"),
    subjectType: normalizeContainerGrantSubjectType(
      record.subjectType,
      "container direct grant",
    ),
  };
}

function containerDirectGrantKey(grant: ContainerDirectGrant): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

function normalizeContainerDirectGrants(
  values: readonly unknown[],
): ContainerDirectGrant[] {
  return normalizeSortedUniqueArray(
    values,
    normalizeContainerDirectGrant,
    containerDirectGrantKey,
    "container direct grants",
  );
}

function normalizeContainerAccessStructural(
  value: unknown,
): ContainerAccessStructural {
  const record = assertExactKeys(
    value,
    ["parentContainerId", "parentManifestHash"],
    "container access structural state",
  );
  const parentContainerId = readNullableString(
    record,
    "parentContainerId",
    "container access structural state",
  );
  const parentManifestHash = readNullableHashString(
    record,
    "parentManifestHash",
    "container access structural state",
  );

  if ((parentContainerId === null) !== (parentManifestHash === null)) {
    throwVerification(
      "invalid_shape",
      "container access parent id and parent manifest hash must both be present or both be null",
    );
  }

  return {
    parentContainerId,
    parentManifestHash,
  };
}

function normalizeContainerAccessMetadata(
  value: unknown,
): ContainerAccessMetadata {
  const record = assertExactKeys(
    value,
    ["metadataDocumentId"],
    "container access metadata state",
  );

  return {
    metadataDocumentId: readString(
      record,
      "metadataDocumentId",
      "container access metadata state",
    ),
  };
}

function normalizeContainerAccessStructuralState(
  value: unknown,
): ContainerAccessStructural & ContainerAccessMetadata {
  const record = assertExactKeys(
    value,
    ["metadataDocumentId", "parentContainerId", "parentManifestHash"],
    "container access structural state",
  );

  return {
    ...normalizeContainerAccessStructural({
      parentContainerId: record.parentContainerId,
      parentManifestHash: record.parentManifestHash,
    }),
    ...normalizeContainerAccessMetadata({
      metadataDocumentId: record.metadataDocumentId,
    }),
  };
}

function normalizeContainerAccessKeyState(
  value: unknown,
): ContainerAccessKeyState {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId"],
    "container access key state",
  );

  return {
    containerKeyEpochId: readNullableString(
      record,
      "containerKeyEpochId",
      "container access key state",
    ),
  };
}

function managedGrantReferenceKey(grant: ContainerDirectGrant): string | null {
  if (grant.subjectType === "user") {
    return null;
  }

  return `${grant.subjectType}:${grant.subjectId}`;
}

function assertReferencedPrincipalHeadsMatchDirectGrants(input: {
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly referencedPrincipalHeads: readonly ReferencedPrincipalHead[];
}): void {
  const managedGrantKeys = new Set<string>();
  for (const grant of input.directGrants) {
    const key = managedGrantReferenceKey(grant);
    if (key) {
      managedGrantKeys.add(key);
    }
  }

  const referencedKeys = new Set<string>();
  for (const principalHead of input.referencedPrincipalHeads) {
    referencedKeys.add(referencedPrincipalKey(principalHead));
  }

  for (const grantKey of managedGrantKeys) {
    if (!referencedKeys.has(grantKey)) {
      throwVerification(
        "missing_dependency",
        "container access manifest is missing a referenced principal head",
      );
    }
  }

  for (const referencedKey of referencedKeys) {
    if (!managedGrantKeys.has(referencedKey)) {
      throwVerification(
        "missing_dependency",
        "container access manifest references a principal without a direct grant",
      );
    }
  }
}

function normalizeContainerAccessGrantState(input: {
  readonly directGrants: unknown;
  readonly label: string;
  readonly referencedPrincipalHeads: unknown;
}): Pick<
  ContainerAccessManifestState,
  "directGrants" | "referencedPrincipalHeads"
> {
  if (!Array.isArray(input.directGrants)) {
    throwVerification(
      "invalid_shape",
      `${input.label}.directGrants must be an array`,
    );
  }

  if (!Array.isArray(input.referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      `${input.label}.referencedPrincipalHeads must be an array`,
    );
  }

  const directGrants = normalizeContainerDirectGrants(input.directGrants);
  const referencedPrincipalHeads = normalizeReferencedPrincipalHeads(
    input.referencedPrincipalHeads,
  );

  assertReferencedPrincipalHeadsMatchDirectGrants({
    directGrants,
    referencedPrincipalHeads,
  });

  return { directGrants, referencedPrincipalHeads };
}

function normalizeContainerAccessManifestState(
  value: ContainerAccessManifestState,
): ContainerAccessManifestState {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpochId",
      "directGrants",
      "epoch",
      "eventHash",
      "metadataDocumentId",
      "organizationId",
      "parentContainerId",
      "parentManifestHash",
      "previousManifestHash",
      "referencedPrincipalHeads",
      "version",
    ],
    "container access manifest state",
  );
  const structural = normalizeContainerAccessStructural({
    parentContainerId: record.parentContainerId,
    parentManifestHash: record.parentManifestHash,
  });
  const keyState = normalizeContainerAccessKeyState({
    containerKeyEpochId: record.containerKeyEpochId,
  });
  const metadata = normalizeContainerAccessMetadata({
    metadataDocumentId: record.metadataDocumentId,
  });
  const grants = normalizeContainerAccessGrantState({
    directGrants: record.directGrants,
    referencedPrincipalHeads: record.referencedPrincipalHeads,
    label: "container access manifest state",
  });

  return {
    version: readVersion(record, "container access manifest state"),
    containerId: readString(
      record,
      "containerId",
      "container access manifest state",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "container access manifest state",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "container access manifest state",
    ),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "container access manifest state",
    ),
    eventHash: readHashString(
      record,
      "eventHash",
      "container access manifest state",
    ),
    ...structural,
    ...keyState,
    ...metadata,
    ...grants,
  };
}

export async function computeContainerAccessStructuralHash(
  structural: ContainerAccessStructural & ContainerAccessMetadata,
): Promise<string> {
  const payload: KeyingCanonicalPayload<
    ContainerAccessStructural & ContainerAccessMetadata
  > = normalizeContainerAccessStructuralState(structural);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-structural",
    payload,
  );
}

export async function computeContainerDirectGrantRoot(
  grants: readonly ContainerDirectGrant[],
): Promise<string> {
  const payload: KeyingCanonicalPayload<readonly ContainerDirectGrant[]> =
    normalizeContainerDirectGrants(grants);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-direct-grants",
    payload,
  );
}

export async function computeContainerAccessKeyTargetHash(
  keyState: ContainerAccessKeyState,
): Promise<string> {
  const payload: KeyingCanonicalPayload<ContainerAccessKeyState> =
    normalizeContainerAccessKeyState(keyState);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-key-target",
    payload,
  );
}

export async function deriveContainerAccessManifest(
  state: ContainerAccessManifestState,
): Promise<AccessManifest> {
  const normalizedState = normalizeContainerAccessManifestState(state);

  return {
    version: 1,
    objectKind: "container",
    objectId: normalizedState.containerId,
    organizationId: normalizedState.organizationId,
    epoch: normalizedState.epoch,
    previousManifestHash: normalizedState.previousManifestHash,
    eventHash: normalizedState.eventHash,
    structuralHash: await computeContainerAccessStructuralHash({
      metadataDocumentId: normalizedState.metadataDocumentId,
      parentContainerId: normalizedState.parentContainerId,
      parentManifestHash: normalizedState.parentManifestHash,
    }),
    grantRoot: await computeContainerDirectGrantRoot(
      normalizedState.directGrants,
    ),
    referencedPrincipalHeads: normalizedState.referencedPrincipalHeads,
    keyTargetHash: await computeContainerAccessKeyTargetHash({
      containerKeyEpochId: normalizedState.containerKeyEpochId,
    }),
  };
}

function normalizeContainerCreateAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerCreateAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "directGrants",
      "eventType",
      "metadataDocumentId",
      "parentContainerId",
      "parentManifestHash",
      "referencedPrincipalHeads",
    ],
    "container.create event body",
  );
  const directGrants = record.directGrants;
  const referencedPrincipalHeads = record.referencedPrincipalHeads;

  if (!Array.isArray(directGrants)) {
    throwVerification(
      "invalid_shape",
      "container.create event body.directGrants must be an array",
    );
  }

  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "container.create event body.referencedPrincipalHeads must be an array",
    );
  }

  const structural = normalizeContainerAccessStructural({
    parentContainerId: record.parentContainerId,
    parentManifestHash: record.parentManifestHash,
  });
  const keyState = normalizeContainerAccessKeyState({
    containerKeyEpochId: record.containerKeyEpochId,
  });
  const metadata = normalizeContainerAccessMetadata({
    metadataDocumentId: record.metadataDocumentId,
  });
  const normalizedDirectGrants = normalizeContainerDirectGrants(directGrants);
  const normalizedReferencedPrincipalHeads = normalizeReferencedPrincipalHeads(
    referencedPrincipalHeads,
  );

  assertReferencedPrincipalHeadsMatchDirectGrants({
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  });

  return {
    eventType: "container.create",
    ...structural,
    ...keyState,
    ...metadata,
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  };
}

function normalizeContainerGrantAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerGrantAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId", "eventType", "grant", "referencedPrincipalHead"],
    "container.grant event body",
  );
  const grant = normalizeContainerDirectGrant(record.grant);
  const referencedPrincipalHead =
    record.referencedPrincipalHead === null
      ? null
      : normalizeReferencedPrincipalHead(record.referencedPrincipalHead);
  const managedGrantKey = managedGrantReferenceKey(grant);

  if (managedGrantKey === null && referencedPrincipalHead !== null) {
    throwVerification(
      "missing_dependency",
      "container.grant user grants must not include a referenced principal head",
    );
  }

  if (
    managedGrantKey !== null &&
    (!referencedPrincipalHead ||
      referencedPrincipalKey(referencedPrincipalHead) !== managedGrantKey)
  ) {
    throwVerification(
      "missing_dependency",
      "container.grant managed-principal grants must include the matching referenced principal head",
    );
  }

  return {
    eventType: "container.grant",
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    }),
    grant,
    referencedPrincipalHead,
  };
}

function normalizeContainerRevokeAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerRevokeAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "eventType",
      "keyringHash",
      "predecessorBridgeHash",
      "subjectId",
      "subjectType",
    ],
    "container.revoke event body",
  );

  return {
    eventType: "container.revoke",
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    }),
    keyringHash: readHashString(
      record,
      "keyringHash",
      "container.revoke event body",
    ),
    predecessorBridgeHash: readHashString(
      record,
      "predecessorBridgeHash",
      "container.revoke event body",
    ),
    subjectId: readString(record, "subjectId", "container.revoke event body"),
    subjectType: normalizeContainerGrantSubjectType(
      record.subjectType,
      "container.revoke event body",
    ),
  };
}

function normalizeContainerRekeyAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerRekeyAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "eventType",
      "keyringHash",
      "predecessorBridgeHash",
      "referencedPrincipalHeads",
    ],
    "container.rekey event body",
  );
  const referencedPrincipalHeads = record.referencedPrincipalHeads;
  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "container.rekey event body.referencedPrincipalHeads must be an array",
    );
  }

  return {
    eventType: "container.rekey",
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "container.rekey event body",
    ),
    keyringHash: readHashString(
      record,
      "keyringHash",
      "container.rekey event body",
    ),
    predecessorBridgeHash: readHashString(
      record,
      "predecessorBridgeHash",
      "container.rekey event body",
    ),
    referencedPrincipalHeads: normalizeReferencedPrincipalHeads(
      referencedPrincipalHeads,
    ),
  };
}

function normalizeContainerMoveAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerMoveAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "eventType",
      "keyringHash",
      "parentContainerId",
      "parentManifestHash",
      "predecessorBridgeHash",
    ],
    "container.move event body",
  );

  return {
    eventType: "container.move",
    ...normalizeContainerAccessStructural({
      parentContainerId: record.parentContainerId,
      parentManifestHash: record.parentManifestHash,
    }),
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    }),
    keyringHash: readHashString(
      record,
      "keyringHash",
      "container.move event body",
    ),
    predecessorBridgeHash: readHashString(
      record,
      "predecessorBridgeHash",
      "container.move event body",
    ),
  };
}

export function normalizeContainerAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "container access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "container access body");

  if (eventType === "container.create") {
    return normalizeContainerCreateAccessEventBody(value);
  }

  if (eventType === "container.grant") {
    return normalizeContainerGrantAccessEventBody(value);
  }

  if (eventType === "container.revoke") {
    return normalizeContainerRevokeAccessEventBody(value);
  }

  if (eventType === "container.rekey") {
    return normalizeContainerRekeyAccessEventBody(value);
  }

  if (eventType === "container.move") {
    return normalizeContainerMoveAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "container access event body eventType is unsupported",
  );
}

function upsertContainerDirectGrant(
  grants: readonly ContainerDirectGrant[],
  grant: ContainerDirectGrant,
): ContainerDirectGrant[] {
  const nextGrants = grants.filter(
    (existingGrant) =>
      containerDirectGrantKey(existingGrant) !== containerDirectGrantKey(grant),
  );
  nextGrants.push(grant);
  return normalizeContainerDirectGrants(nextGrants);
}

function removeContainerDirectGrant(
  grants: readonly ContainerDirectGrant[],
  revokedGrant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): ContainerDirectGrant[] {
  const revokedGrantKey = `${revokedGrant.subjectType}:${revokedGrant.subjectId}`;
  return normalizeContainerDirectGrants(
    grants.filter(
      (existingGrant) =>
        containerDirectGrantKey(existingGrant) !== revokedGrantKey,
    ),
  );
}

function upsertReferencedPrincipalHead(
  principalHeads: readonly ReferencedPrincipalHead[],
  principalHead: ReferencedPrincipalHead,
): ReferencedPrincipalHead[] {
  const nextPrincipalHeads = principalHeads.filter(
    (existingHead) =>
      referencedPrincipalKey(existingHead) !==
      referencedPrincipalKey(principalHead),
  );
  nextPrincipalHeads.push(principalHead);
  return normalizeReferencedPrincipalHeads(nextPrincipalHeads);
}

function removeReferencedPrincipalHead(
  principalHeads: readonly ReferencedPrincipalHead[],
  revokedGrant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): ReferencedPrincipalHead[] {
  if (revokedGrant.subjectType === "user") {
    return normalizeReferencedPrincipalHeads(principalHeads);
  }

  const revokedReferenceKey = `${revokedGrant.subjectType}:${revokedGrant.subjectId}`;
  return normalizeReferencedPrincipalHeads(
    principalHeads.filter(
      (principalHead) =>
        referencedPrincipalKey(principalHead) !== revokedReferenceKey,
    ),
  );
}

export function requireContainerPathLast(
  path: readonly VerifiedContainerAccessManifest[] | undefined,
  label: string,
): VerifiedContainerAccessManifest {
  const lastManifest = path?.at(-1);
  if (!lastManifest) {
    throwVerification("missing_dependency", `${label} path is required`);
  }

  return lastManifest;
}

function requirePathLastMatchesManifest(input: {
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly label: string;
}): void {
  const lastManifest = requireContainerPathLast(input.path, input.label);

  if (lastManifest.manifestHash !== input.manifest.manifestHash) {
    throwVerification(
      "missing_dependency",
      `${input.label} path does not end at the expected manifest`,
    );
  }
}

export function principalPolicyMatchesReference(input: {
  readonly policy: VerifiedPrincipalPolicy;
  readonly reference: ReferencedPrincipalHead;
}): boolean {
  const policyHeadMatches =
    input.policy.principalType === input.reference.principalType &&
    input.policy.principalId === input.reference.principalId &&
    input.policy.version === input.reference.version &&
    input.policy.keyEpoch === input.reference.keyEpoch &&
    input.policy.stateHash === input.reference.stateHash &&
    input.policy.state.keyFingerprint === input.reference.keyFingerprint;

  return (
    policyHeadMatches ||
    input.policy.history?.some(
      (entry) =>
        entry.state.principalType === input.reference.principalType &&
        entry.state.principalId === input.reference.principalId &&
        entry.state.version === input.reference.version &&
        entry.state.keyEpoch === input.reference.keyEpoch &&
        entry.state.stateHash === input.reference.stateHash &&
        entry.state.keyFingerprint === input.reference.keyFingerprint,
    ) === true
  );
}

function grantAccessLevelForUser(input: {
  readonly grant: ContainerDirectGrant;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly state: Pick<
    ContainerAccessManifestState,
    "referencedPrincipalHeads"
  >;
  readonly userId: string;
}): ContainerAccessLevel | null {
  if (input.grant.subjectType === "user") {
    return input.grant.subjectId === input.userId
      ? input.grant.accessLevel
      : null;
  }

  const referencedHead = input.state.referencedPrincipalHeads.find(
    (principalHead) =>
      principalHead.principalType === input.grant.subjectType &&
      principalHead.principalId === input.grant.subjectId,
  );

  if (!referencedHead) {
    return null;
  }

  const verifiedPolicy = input.principalPolicies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference: referencedHead }),
  );

  if (!verifiedPolicy) {
    return null;
  }

  return verifiedPolicy.projection.some(
    (member) => member.userId === input.userId,
  )
    ? input.grant.accessLevel
    : null;
}

export function resolveContainerPathUserAccessLevel(input: {
  readonly path: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly userId: string;
}): ContainerAccessLevel | null {
  let accessLevel: ContainerAccessLevel | null = null;

  for (const containerManifest of input.path) {
    for (const grant of containerManifest.state.directGrants) {
      const grantAccessLevel = grantAccessLevelForUser({
        grant,
        principalPolicies: input.principalPolicies ?? [],
        state: containerManifest.state,
        userId: input.userId,
      });

      if (grantAccessLevel) {
        accessLevel = mergeContainerAccessLevel(accessLevel, grantAccessLevel);
      }
    }
  }

  return accessLevel;
}

export function requireContainerPathUserAccess(input: {
  readonly label: string;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly userId: string;
}): void {
  const path = input.path;
  if (!path || path.length === 0) {
    throwVerification("missing_dependency", `${input.label} path is required`);
  }

  const accessLevel = resolveContainerPathUserAccessLevel({
    path,
    principalPolicies: input.principalPolicies,
    userId: input.userId,
  });

  if (
    accessLevel === null ||
    containerAccessLevelRank(accessLevel) <
      containerAccessLevelRank(input.minimumAccessLevel)
  ) {
    throwVerification(
      "unauthorized",
      `${input.label} signer lacks ${input.minimumAccessLevel} access`,
    );
  }
}

function requireContainerPathCurrentParent(input: {
  readonly parentContainerId: string | null;
  readonly parentManifestHash: string | null;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly label: string;
}): void {
  if (!input.parentContainerId || !input.parentManifestHash) {
    throwVerification(
      "missing_dependency",
      `${input.label} parent manifest is required`,
    );
  }

  const parentManifest = requireContainerPathLast(input.path, input.label);
  if (
    parentManifest.state.containerId !== input.parentContainerId ||
    parentManifest.manifestHash !== input.parentManifestHash
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} parent manifest hash mismatch`,
    );
  }
}

function requireRootCreateSignerAdmin(input: {
  readonly body: ContainerCreateAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): void {
  if (input.parentContainerPath && input.parentContainerPath.length > 0) {
    throwVerification(
      "invalid_shape",
      "root container.create must not include a parent path",
    );
  }

  const accessLevel =
    input.body.directGrants.reduce<ContainerAccessLevel | null>(
      (current, grant) => {
        const grantAccessLevel = grantAccessLevelForUser({
          grant,
          principalPolicies: input.principalPolicies,
          state: {
            referencedPrincipalHeads: input.body.referencedPrincipalHeads,
          },
          userId: input.event.event.signerUserId,
        });

        return grantAccessLevel
          ? mergeContainerAccessLevel(current, grantAccessLevel)
          : current;
      },
      null,
    );

  if (
    accessLevel === null ||
    containerAccessLevelRank(accessLevel) < containerAccessLevelRank("admin")
  ) {
    throwVerification(
      "unauthorized",
      "root container.create signer must grant themselves admin access",
    );
  }
}

type ContainerAccessManifestDerivationInput = {
  readonly body: ContainerAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly previousContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly destinationParentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
};

type ContainerAccessManifestTransitionBase = Omit<
  ContainerAccessManifestState,
  "containerKeyEpochId" | "directGrants" | "referencedPrincipalHeads"
>;

interface PreviousContainerAccessTransition {
  readonly nextBase: ContainerAccessManifestTransitionBase;
  readonly previousState: ContainerAccessManifestState;
}

function assertContainerAccessEventDomain(
  input: ContainerAccessManifestDerivationInput,
): void {
  const { body, event } = input;

  if (event.event.objectKind !== "container") {
    throwVerification(
      "object_mismatch",
      "container access event must target a container",
    );
  }

  if (body.eventType !== event.event.eventType) {
    throwVerification(
      "invalid_domain",
      "container access event body type does not match event type",
    );
  }
}

function deriveContainerCreateManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerCreateAccessEventBody,
): ContainerAccessManifestState {
  const { event, previousManifest } = input;

  if (previousManifest !== null || event.event.previousManifestHash !== null) {
    throwVerification(
      "stale_predecessor",
      "container.create must not have a previous manifest",
    );
  }

  if (body.parentContainerId === null && body.parentManifestHash === null) {
    requireRootCreateSignerAdmin({
      body,
      event,
      parentContainerPath: input.parentContainerPath,
      principalPolicies: input.principalPolicies,
    });
  } else {
    requireContainerPathCurrentParent({
      label: "container.create",
      parentContainerId: body.parentContainerId,
      parentManifestHash: body.parentManifestHash,
      path: input.parentContainerPath,
    });
    requireContainerPathUserAccess({
      label: "container.create",
      minimumAccessLevel: "write",
      path: input.parentContainerPath,
      principalPolicies: input.principalPolicies,
      userId: event.event.signerUserId,
    });
  }

  return normalizeContainerAccessManifestState({
    version: 1,
    containerId: event.event.objectId,
    organizationId: event.event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    metadataDocumentId: body.metadataDocumentId,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  });
}

function preparePreviousContainerAccessTransition(
  input: ContainerAccessManifestDerivationInput,
): PreviousContainerAccessTransition {
  const { body, event, previousManifest } = input;

  if (!previousManifest) {
    throwVerification(
      "missing_dependency",
      `${body.eventType} requires the previous container manifest`,
    );
  }

  if (event.event.previousManifestHash !== previousManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "container access event previous manifest does not match supplied previous manifest",
    );
  }

  requirePathLastMatchesManifest({
    label: "previous container",
    manifest: previousManifest,
    path: input.previousContainerPath,
  });

  const previousState = previousManifest.state;

  return {
    previousState,
    nextBase: {
      version: 1,
      containerId: previousState.containerId,
      organizationId: previousState.organizationId,
      epoch: previousState.epoch + 1,
      previousManifestHash: previousManifest.manifestHash,
      eventHash: event.eventHash,
      parentContainerId: previousState.parentContainerId,
      parentManifestHash: previousState.parentManifestHash,
      metadataDocumentId: previousState.metadataDocumentId,
    },
  };
}

function deriveContainerGrantManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerGrantAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.grant",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (body.containerKeyEpochId !== previous.previousState.containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container.grant must keep the current container KEK epoch",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: upsertContainerDirectGrant(
      previous.previousState.directGrants,
      body.grant,
    ),
    referencedPrincipalHeads: body.referencedPrincipalHead
      ? upsertReferencedPrincipalHead(
          previous.previousState.referencedPrincipalHeads,
          body.referencedPrincipalHead,
        )
      : previous.previousState.referencedPrincipalHeads,
  });
}

function deriveContainerRevokeManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerRevokeAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.revoke",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    body.containerKeyEpochId === null ||
    body.containerKeyEpochId === previous.previousState.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container.revoke must create a new container KEK epoch",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: removeContainerDirectGrant(
      previous.previousState.directGrants,
      body,
    ),
    referencedPrincipalHeads: removeReferencedPrincipalHead(
      previous.previousState.referencedPrincipalHeads,
      body,
    ),
  });
}

function deriveContainerRekeyManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerRekeyAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.rekey",
    minimumAccessLevel: "write",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (body.containerKeyEpochId === previous.previousState.containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container.rekey must create a new container KEK epoch",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: previous.previousState.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  });
}

function deriveContainerMoveManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerMoveAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.move source",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });
  requireContainerPathCurrentParent({
    label: "container.move destination",
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    path: input.destinationParentContainerPath,
  });
  requireContainerPathUserAccess({
    label: "container.move destination",
    minimumAccessLevel: "write",
    path: input.destinationParentContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    input.destinationParentContainerPath?.some(
      (containerManifest) =>
        containerManifest.state.containerId ===
        previous.previousState.containerId,
    )
  ) {
    throwVerification(
      "object_mismatch",
      "container.move destination parent cannot be the moved container or its descendant",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: previous.previousState.directGrants,
    referencedPrincipalHeads: previous.previousState.referencedPrincipalHeads,
  });
}

function deriveContainerAccessManifestStateFromEvent(
  input: ContainerAccessManifestDerivationInput,
): ContainerAccessManifestState {
  assertContainerAccessEventDomain(input);

  if (input.body.eventType === "container.create") {
    return deriveContainerCreateManifestState(input, input.body);
  }

  const previous = preparePreviousContainerAccessTransition(input);

  if (input.body.eventType === "container.grant") {
    return deriveContainerGrantManifestState(input, input.body, previous);
  }

  if (input.body.eventType === "container.revoke") {
    return deriveContainerRevokeManifestState(input, input.body, previous);
  }

  if (input.body.eventType === "container.rekey") {
    return deriveContainerRekeyManifestState(input, input.body, previous);
  }

  return deriveContainerMoveManifestState(input, input.body, previous);
}

export async function verifyContainerAccessManifest({
  checkpointPredecessors,
  destinationParentContainerPath,
  event,
  expectedManifestHash,
  localCheckpoint,
  manifest,
  parentContainerPath,
  previousContainerPath,
  previousManifest = null,
  principalPolicies = [],
}: VerifyContainerAccessManifestInput): Promise<
  KeyingVerificationResult<VerifiedContainerAccessManifest>
> {
  return runVerifier(async () => {
    const body = normalizeContainerAccessEventBody(event.body);
    const state = deriveContainerAccessManifestStateFromEvent({
      body,
      destinationParentContainerPath,
      event,
      parentContainerPath,
      previousContainerPath,
      previousManifest,
      principalPolicies,
    });
    const derivedManifest = await deriveContainerAccessManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);

    if (derivedManifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "container access manifest hash does not match derived state",
      );
    }

    const verifiedManifest = await verifyAccessManifest({
      manifest,
      expectedManifestHash,
      event,
      expectedObject: {
        objectKind: "container",
        objectId: state.containerId,
      },
      expectedPreviousManifestHash: state.previousManifestHash,
      localCheckpoint,
      checkpointPredecessors,
    });

    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }

    return makeVerifiedContainerAccessManifest({
      manifest: verifiedManifest.value.manifest,
      manifestHash: verifiedManifest.value.manifestHash,
      event,
      state,
      checkpoint: verifiedManifest.value.checkpoint,
    });
  });
}
