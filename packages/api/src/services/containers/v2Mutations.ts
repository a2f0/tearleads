import type {
  AccessEventTypeV2,
  AccessManifestCheckpointV2,
  AccessManifestV2,
  ContainerAccessLevelV2,
  ContainerAccessManifestStateV2,
  ContainerDirectGrantV2,
  ContainerGrantSubjectTypeV2,
  ContainerKekRecipientTargetV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  KeyingV2CanonicalJson,
  ManagedPrincipalKindV2,
  PrincipalPolicyCheckpointV2,
  PrincipalPolicySignedStateV2,
  PrincipalProjectionMember,
  ReferencedPrincipalHeadV2,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  KeyingV2VerificationError,
  serializeKeyingV2CanonicalJson,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  ContainerV2ManifestBundle,
  ContainerV2MutationRequest,
} from "@tearleads/validators/request";
import type { ContainerV2MutationResponse } from "@tearleads/validators/response";
import { eq, inArray } from "drizzle-orm";
import {
  getCurrentAccessManifestHead,
  storeVerifiedAccessManifest,
} from "../../access/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  storeVerifiedContainerKekState,
} from "../../access/containerKekStore";
import {
  getCurrentPrincipalStates,
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../access/principalStateStore";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  containerMetadataDocuments,
  containers,
  documents,
  users,
} from "../../schema";
import {
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
  readProjectionAccessEvent,
  readProjectionAccessManifest,
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionReferencedPrincipalHeads,
  readProjectionString,
  readProjectionValue,
  readProjectionVerifiedAccessEvent,
  readProjectionVersion2,
} from "../keyingV2ProjectionRecords";
import type { ApiServiceRuntime } from "../runtime";

type ContainerV2MutationStatus = 400 | 403 | 404 | 409;

export class ContainerV2MutationError extends Error {
  constructor(
    message: string,
    readonly status: ContainerV2MutationStatus,
  ) {
    super(message);
    this.name = "ContainerV2MutationError";
  }
}

interface MutateContainerV2Input {
  readonly expectedContainerId?: string;
  readonly expectedEventType: AccessEventTypeV2;
  readonly fingerprint: string;
  readonly request: ContainerV2MutationRequest;
  readonly userId: string;
}

interface MutateContainerV2WithExecutorInput extends MutateContainerV2Input {
  readonly executor: DatabaseExecutor;
}

interface StoredContainerRow {
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
}

type VerifiedContainerAccessState = VerifiedContainerAccessManifest["state"];
// Verified crypto brands are compile-time only. Request/projection JSON can only
// rehydrate public fields; callers still run the corresponding verifier or
// current-head check before trusting these values.
type UnbrandedVerified<T> = {
  readonly [K in keyof T as K extends symbol ? never : K]: T[K];
};

type CurrentAccessManifestHead = Awaited<
  ReturnType<typeof getCurrentAccessManifestHead>
>;

interface ContainerV2MutationContext {
  readonly executor: DatabaseExecutor;
  readonly manifestHeadByContainerId: Map<string, CurrentAccessManifestHead>;
}

function mutationShapeError(message: string): ContainerV2MutationError {
  return new ContainerV2MutationError(message, 400);
}

function readNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = readProjectionValue(record, key);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw mutationShapeError(`${label}.${key} is invalid`);
  }
  return value;
}

function isManagedPrincipalKind(
  value: unknown,
): value is ManagedPrincipalKindV2 {
  return value === "group" || value === "organization";
}

function isPrincipalProjectionMemberType(
  value: unknown,
): value is PrincipalProjectionMember["memberPrincipalType"] {
  return value === "group" || value === "user";
}

function isPrincipalProjectionRole(
  value: unknown,
): value is PrincipalProjectionMember["role"] {
  return value === "admin" || value === "member";
}

function isContainerAccessLevel(
  value: unknown,
): value is ContainerAccessLevelV2 {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerGrantSubjectTypeV2 {
  return value === "group" || value === "organization" || value === "user";
}

function isKekRecipientKind(
  value: unknown,
): value is ContainerKeyWrapV2["recipientKind"] {
  return (
    value === "container" ||
    value === "group" ||
    value === "organization" ||
    value === "user"
  );
}

function readContainerDirectGrant(
  value: unknown,
  label: string,
): ContainerDirectGrantV2 {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const accessLevel = readProjectionValue(record, "accessLevel");
  const subjectType = readProjectionValue(record, "subjectType");

  if (!isContainerAccessLevel(accessLevel)) {
    throw mutationShapeError(`${label}.accessLevel is invalid`);
  }
  if (!isContainerGrantSubjectType(subjectType)) {
    throw mutationShapeError(`${label}.subjectType is invalid`);
  }

  return {
    accessLevel,
    subjectId: readProjectionString(
      record,
      "subjectId",
      label,
      mutationShapeError,
    ),
    subjectType,
  };
}

function readContainerDirectGrants(
  value: unknown,
  label: string,
): ContainerDirectGrantV2[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerDirectGrant(entry, `${label}[${index}]`),
  );
}

function referencedPrincipalHeadRecord(
  principalHead: ReferencedPrincipalHeadV2,
): Record<string, unknown> {
  return {
    principalType: principalHead.principalType,
    principalId: principalHead.principalId,
    version: principalHead.version,
    keyEpoch: principalHead.keyEpoch,
    stateHash: principalHead.stateHash,
    keyFingerprint: principalHead.keyFingerprint,
  };
}

function readContainerAccessState(
  value: unknown,
  label: string,
): ContainerAccessManifestStateV2 {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  readProjectionVersion2(record, label, mutationShapeError);

  return {
    version: 2,
    containerId: readProjectionString(
      record,
      "containerId",
      label,
      mutationShapeError,
    ),
    organizationId: readProjectionString(
      record,
      "organizationId",
      label,
      mutationShapeError,
    ),
    epoch: readProjectionPositiveInteger(
      record,
      "epoch",
      label,
      mutationShapeError,
    ),
    previousManifestHash: readProjectionNullableString(
      record,
      "previousManifestHash",
      label,
      mutationShapeError,
    ),
    eventHash: readProjectionString(
      record,
      "eventHash",
      label,
      mutationShapeError,
    ),
    parentContainerId: readProjectionNullableString(
      record,
      "parentContainerId",
      label,
      mutationShapeError,
    ),
    parentManifestHash: readProjectionNullableString(
      record,
      "parentManifestHash",
      label,
      mutationShapeError,
    ),
    metadataDocumentId: readProjectionString(
      record,
      "metadataDocumentId",
      label,
      mutationShapeError,
    ),
    containerKeyEpochId: readProjectionNullableString(
      record,
      "containerKeyEpochId",
      label,
      mutationShapeError,
    ),
    directGrants: readContainerDirectGrants(
      readProjectionValue(record, "directGrants"),
      `${label}.directGrants`,
    ),
    referencedPrincipalHeads: readProjectionReferencedPrincipalHeads(
      readProjectionValue(record, "referencedPrincipalHeads"),
      `${label}.referencedPrincipalHeads`,
      mutationShapeError,
    ),
  };
}

function containerAccessStateRecord(
  state: ContainerAccessManifestStateV2,
): Record<string, unknown> {
  return {
    version: state.version,
    containerId: state.containerId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    parentContainerId: state.parentContainerId,
    parentManifestHash: state.parentManifestHash,
    metadataDocumentId: state.metadataDocumentId,
    containerKeyEpochId: state.containerKeyEpochId,
    directGrants: state.directGrants.map((grant) => ({ ...grant })),
    referencedPrincipalHeads: state.referencedPrincipalHeads.map(
      referencedPrincipalHeadRecord,
    ),
  };
}

function accessManifestCheckpoint(input: {
  readonly manifest: AccessManifestV2;
  readonly manifestHash: string;
}): AccessManifestCheckpointV2 {
  return {
    objectKind: input.manifest.objectKind,
    objectId: input.manifest.objectId,
    organizationId: input.manifest.organizationId,
    epoch: input.manifest.epoch,
    manifestHash: input.manifestHash,
  };
}

function readVerifiedContainerManifest(
  bundle: ContainerV2ManifestBundle,
  label: string,
): VerifiedContainerAccessManifest {
  const manifest = readProjectionAccessManifest(
    bundle.manifest,
    `${label}.manifest`,
    mutationShapeError,
  );

  const verified: UnbrandedVerified<VerifiedContainerAccessManifest> = {
    event: readProjectionVerifiedAccessEvent(
      bundle.event,
      `${label}.event`,
      mutationShapeError,
    ),
    manifest,
    manifestHash: bundle.manifestHash,
    state: readContainerAccessState(bundle.state, `${label}.state`),
    checkpoint: accessManifestCheckpoint({
      manifest,
      manifestHash: bundle.manifestHash,
    }),
  };

  return verified as VerifiedContainerAccessManifest;
}

function readVerifiedContainerManifestArray(
  bundles: readonly ContainerV2ManifestBundle[] | undefined,
  label: string,
): VerifiedContainerAccessManifest[] | undefined {
  return bundles?.map((bundle, index) =>
    readVerifiedContainerManifest(bundle, `${label}[${index}]`),
  );
}

function readPrincipalProjectionMember(
  value: unknown,
  label: string,
): PrincipalProjectionMember {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const memberPrincipalType = readProjectionValue(
    record,
    "memberPrincipalType",
  );
  const role = readProjectionValue(record, "role");

  if (!isPrincipalProjectionMemberType(memberPrincipalType)) {
    throw mutationShapeError(`${label}.memberPrincipalType is invalid`);
  }
  if (!isPrincipalProjectionRole(role)) {
    throw mutationShapeError(`${label}.role is invalid`);
  }

  return {
    memberPrincipalType,
    memberPrincipalId: readProjectionString(
      record,
      "memberPrincipalId",
      label,
      mutationShapeError,
    ),
    role,
  };
}

function readPrincipalProjectionMembers(
  value: unknown,
  label: string,
): PrincipalProjectionMember[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }

  return value.map((entry, index) =>
    readPrincipalProjectionMember(entry, `${label}[${index}]`),
  );
}

function readPrincipalPolicyState(
  value: unknown,
  label: string,
): PrincipalPolicySignedStateV2 {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const readStringField = (key: string) =>
    readProjectionString(record, key, label, mutationShapeError);
  const readPositiveField = (key: string) =>
    readProjectionPositiveInteger(record, key, label, mutationShapeError);
  const principalType = readProjectionValue(record, "principalType");
  const membershipMode = readProjectionValue(record, "membershipMode");

  if (!isManagedPrincipalKind(principalType)) {
    throw mutationShapeError(`${label}.principalType is invalid`);
  }
  if (membershipMode !== "projection") {
    throw mutationShapeError(`${label}.membershipMode is invalid`);
  }

  return {
    principalType,
    principalId: readStringField("principalId"),
    version: readPositiveField("version"),
    prevStateHash: readProjectionNullableString(
      record,
      "prevStateHash",
      label,
      mutationShapeError,
    ),
    keyEpoch: readPositiveField("keyEpoch"),
    encapsulationPublicKey: readStringField("encapsulationPublicKey"),
    keyFingerprint: readStringField("keyFingerprint"),
    membershipMode,
    membershipRoot: readStringField("membershipRoot"),
    projectionRoot: readStringField("projectionRoot"),
    payloadCiphertextHash: readStringField("payloadCiphertextHash"),
    memberCount: readNonNegativeInteger(record, "memberCount", label),
    signedAt: readStringField("signedAt"),
    signerUserId: readStringField("signerUserId"),
    signerUserKeyFingerprint: readStringField("signerUserKeyFingerprint"),
    stateHash: readStringField("stateHash"),
    signature: readStringField("signature"),
  };
}

function readPrincipalPolicyCheckpoint(
  value: unknown,
  label: string,
): PrincipalPolicyCheckpointV2 {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const principalType = readProjectionValue(record, "principalType");
  if (!isManagedPrincipalKind(principalType)) {
    throw mutationShapeError(`${label}.principalType is invalid`);
  }

  return {
    principalType,
    principalId: readProjectionString(
      record,
      "principalId",
      label,
      mutationShapeError,
    ),
    version: readProjectionPositiveInteger(
      record,
      "version",
      label,
      mutationShapeError,
    ),
    stateHash: readProjectionString(
      record,
      "stateHash",
      label,
      mutationShapeError,
    ),
  };
}

type PrincipalPolicyCommonFields = Pick<
  VerifiedPrincipalPolicy,
  "principalId" | "principalType" | "stateHash" | "version"
>;

function principalPolicyCommonFieldsMatch(
  left: PrincipalPolicyCommonFields,
  right: PrincipalPolicyCommonFields,
): boolean {
  return (
    left.principalType === right.principalType &&
    left.principalId === right.principalId &&
    left.version === right.version &&
    left.stateHash === right.stateHash
  );
}

function readVerifiedPrincipalPolicy(
  value: unknown,
  label: string,
): VerifiedPrincipalPolicy {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const principalType = readProjectionValue(record, "principalType");
  if (!isManagedPrincipalKind(principalType)) {
    throw mutationShapeError(`${label}.principalType is invalid`);
  }

  const state = readPrincipalPolicyState(
    readProjectionValue(record, "state"),
    `${label}.state`,
  );
  const policy: UnbrandedVerified<VerifiedPrincipalPolicy> = {
    principalType,
    principalId: readProjectionString(
      record,
      "principalId",
      label,
      mutationShapeError,
    ),
    version: readProjectionPositiveInteger(
      record,
      "version",
      label,
      mutationShapeError,
    ),
    keyEpoch: readProjectionPositiveInteger(
      record,
      "keyEpoch",
      label,
      mutationShapeError,
    ),
    stateHash: readProjectionString(
      record,
      "stateHash",
      label,
      mutationShapeError,
    ),
    state,
    projection: readPrincipalProjectionMembers(
      readProjectionValue(record, "projection"),
      `${label}.projection`,
    ),
    checkpoint: readPrincipalPolicyCheckpoint(
      readProjectionValue(record, "checkpoint"),
      `${label}.checkpoint`,
    ),
  };

  if (
    !principalPolicyCommonFieldsMatch(policy, policy.state) ||
    policy.state.keyEpoch !== policy.keyEpoch ||
    !principalPolicyCommonFieldsMatch(policy, policy.checkpoint)
  ) {
    throw mutationShapeError(`${label} domains are inconsistent`);
  }

  return policy as VerifiedPrincipalPolicy;
}

function principalPoliciesFromRequest(
  request: ContainerV2MutationRequest,
): VerifiedPrincipalPolicy[] {
  return (request.principalPolicies ?? []).map((policy, index) =>
    readVerifiedPrincipalPolicy(policy, `principalPolicies[${index}]`),
  );
}

function userRecipientKeysFromRequest(
  request: ContainerV2MutationRequest,
): ContainerUserRecipientKeyV2[] {
  return (request.userRecipientKeys ?? []).map((key, index) =>
    readContainerUserRecipientKey(key, `userRecipientKeys[${index}]`),
  );
}

function readContainerUserRecipientKey(
  value: unknown,
  label: string,
): ContainerUserRecipientKeyV2 {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  return {
    userId: readProjectionString(record, "userId", label, mutationShapeError),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      mutationShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      mutationShapeError,
    ),
  };
}

function readContainerKeyEpoch(
  value: unknown,
  label: string,
): ContainerKeyEpochV2 {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  return {
    id: readProjectionString(record, "id", label, mutationShapeError),
    containerId: readProjectionString(
      record,
      "containerId",
      label,
      mutationShapeError,
    ),
    keyEpoch: readProjectionPositiveInteger(
      record,
      "keyEpoch",
      label,
      mutationShapeError,
    ),
    accessManifestHash: readProjectionString(
      record,
      "accessManifestHash",
      label,
      mutationShapeError,
    ),
    parentContainerKeyEpochId: readProjectionNullableString(
      record,
      "parentContainerKeyEpochId",
      label,
      mutationShapeError,
    ),
    createdByEventHash: readProjectionString(
      record,
      "createdByEventHash",
      label,
      mutationShapeError,
    ),
    createdByManifestHash: readProjectionString(
      record,
      "createdByManifestHash",
      label,
      mutationShapeError,
    ),
  };
}

function containerKeyEpochRecord(
  keyEpoch: ContainerKeyEpochV2,
): Record<string, unknown> {
  return {
    id: keyEpoch.id,
    containerId: keyEpoch.containerId,
    keyEpoch: keyEpoch.keyEpoch,
    accessManifestHash: keyEpoch.accessManifestHash,
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    createdByEventHash: keyEpoch.createdByEventHash,
    createdByManifestHash: keyEpoch.createdByManifestHash,
  };
}

function readContainerKeyWrap(
  value: unknown,
  label: string,
): ContainerKeyWrapV2 {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const recipientKind = readProjectionValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw mutationShapeError(`${label}.recipientKind is invalid`);
  }

  return {
    containerKeyEpochId: readProjectionString(
      record,
      "containerKeyEpochId",
      label,
      mutationShapeError,
    ),
    recipientKind,
    recipientId: readProjectionString(
      record,
      "recipientId",
      label,
      mutationShapeError,
    ),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      mutationShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      mutationShapeError,
    ),
    kemCipherText: readProjectionString(
      record,
      "kemCipherText",
      label,
      mutationShapeError,
    ),
    wrappedKey: readProjectionString(
      record,
      "wrappedKey",
      label,
      mutationShapeError,
    ),
    wrapManifestHash: readProjectionString(
      record,
      "wrapManifestHash",
      label,
      mutationShapeError,
    ),
  };
}

function readContainerKeyWraps(
  value: unknown,
  label: string,
): ContainerKeyWrapV2[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerKeyWrap(entry, `${label}[${index}]`),
  );
}

function containerKeyWrapRecord(
  wrap: ContainerKeyWrapV2,
): Record<string, unknown> {
  return {
    containerKeyEpochId: wrap.containerKeyEpochId,
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
    kemCipherText: wrap.kemCipherText,
    wrappedKey: wrap.wrappedKey,
    wrapManifestHash: wrap.wrapManifestHash,
  };
}

function readContainerKekRecipientTarget(
  value: unknown,
  label: string,
): ContainerKekRecipientTargetV2 {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const recipientKind = readProjectionValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw mutationShapeError(`${label}.recipientKind is invalid`);
  }

  return {
    recipientKind,
    recipientId: readProjectionString(
      record,
      "recipientId",
      label,
      mutationShapeError,
    ),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      mutationShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      mutationShapeError,
    ),
  };
}

function readContainerKekRecipientTargets(
  value: unknown,
  label: string,
): ContainerKekRecipientTargetV2[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerKekRecipientTarget(entry, `${label}[${index}]`),
  );
}

function containerKekRecipientTargetRecord(
  target: ContainerKekRecipientTargetV2,
): Record<string, unknown> {
  return {
    recipientKind: target.recipientKind,
    recipientId: target.recipientId,
    recipientKeyEpochId: target.recipientKeyEpochId,
    recipientKeyFingerprint: target.recipientKeyFingerprint,
  };
}

function readVerifiedContainerKekState(
  value: unknown,
  label: string,
): VerifiedContainerKekState {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);

  const verified: UnbrandedVerified<VerifiedContainerKekState> = {
    containerId: readProjectionString(
      record,
      "containerId",
      label,
      mutationShapeError,
    ),
    accessManifestHash: readProjectionString(
      record,
      "accessManifestHash",
      label,
      mutationShapeError,
    ),
    containerKeyEpochId: readProjectionString(
      record,
      "containerKeyEpochId",
      label,
      mutationShapeError,
    ),
    containerKeyEpoch: readProjectionPositiveInteger(
      record,
      "containerKeyEpoch",
      label,
      mutationShapeError,
    ),
    keyEpoch: readContainerKeyEpoch(
      readProjectionValue(record, "keyEpoch"),
      `${label}.keyEpoch`,
    ),
    keyEpochHash: readProjectionString(
      record,
      "keyEpochHash",
      label,
      mutationShapeError,
    ),
    parentContainerKeyEpochId: readProjectionNullableString(
      record,
      "parentContainerKeyEpochId",
      label,
      mutationShapeError,
    ),
    keyTargetHash: readProjectionString(
      record,
      "keyTargetHash",
      label,
      mutationShapeError,
    ),
    recipientTargets: readContainerKekRecipientTargets(
      readProjectionValue(record, "recipientTargets"),
      `${label}.recipientTargets`,
    ),
    wraps: readContainerKeyWraps(
      readProjectionValue(record, "wraps"),
      `${label}.wraps`,
    ),
  };

  return verified as VerifiedContainerKekState;
}

function canonicalJsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  return (
    serializeKeyingV2CanonicalJson(left as KeyingV2CanonicalJson) ===
    serializeKeyingV2CanonicalJson(right as KeyingV2CanonicalJson)
  );
}

function projectionMemberKey(
  member: Pick<
    PrincipalProjectionMember,
    "memberPrincipalId" | "memberPrincipalType" | "role"
  >,
): string {
  return [
    member.memberPrincipalType,
    member.memberPrincipalId,
    member.role,
  ].join(":");
}

function principalPolicyKey(
  policy: Pick<VerifiedPrincipalPolicy, "principalId" | "principalType">,
): string {
  return `${policy.principalType}:${policy.principalId}`;
}

function principalProjectionStateKey(input: {
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalId}:${input.stateHash}`;
}

function toContainerKeyEpoch(
  keyEpoch: ContainerKeyEpochV2 & { readonly createdAt?: Date },
): ContainerKeyEpochV2 {
  return {
    id: keyEpoch.id,
    containerId: keyEpoch.containerId,
    keyEpoch: keyEpoch.keyEpoch,
    accessManifestHash: keyEpoch.accessManifestHash,
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    createdByEventHash: keyEpoch.createdByEventHash,
    createdByManifestHash: keyEpoch.createdByManifestHash,
  };
}

function mapVerificationStatus(
  error: KeyingV2VerificationError,
): ContainerV2MutationStatus {
  if (
    error.code === "signature_mismatch" ||
    error.code === "signer_mismatch" ||
    error.code === "unauthorized"
  ) {
    return 403;
  }

  if (error.code === "invalid_domain" || error.code === "invalid_shape") {
    return 400;
  }

  if (error.code === "object_mismatch") {
    return 400;
  }

  return 409;
}

function toMutationError(error: unknown): ContainerV2MutationError | null {
  if (error instanceof ContainerV2MutationError) {
    return error;
  }

  if (error instanceof KeyingV2VerificationError) {
    return new ContainerV2MutationError(
      error.message,
      mapVerificationStatus(error),
    );
  }

  if (!(error instanceof Error)) {
    return null;
  }

  return null;
}

async function runConflictBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ContainerV2MutationError ||
      error instanceof KeyingV2VerificationError
    ) {
      throw error;
    }

    throw new ContainerV2MutationError(
      error instanceof Error ? error.message : String(error),
      409,
    );
  }
}

async function loadSignerPublicKey(
  executor: DatabaseExecutor,
  input: {
    readonly fingerprint: string;
    readonly userId: string;
  },
): Promise<Uint8Array> {
  const [user] = await executor
    .select({
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user || user.fingerprint !== input.fingerprint) {
    throw new ContainerV2MutationError("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}

async function verifyMutationEvent(
  executor: DatabaseExecutor,
  input: MutateContainerV2Input,
) {
  const event = readProjectionAccessEvent(
    input.request.event,
    "Container V2 mutation event",
    mutationShapeError,
  );

  if (
    event.signerUserId !== input.userId ||
    event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new ContainerV2MutationError("Forbidden", 403);
  }

  if (event.eventType !== input.expectedEventType) {
    throw new ContainerV2MutationError("Unexpected container event type", 400);
  }

  if (
    input.expectedContainerId !== undefined &&
    event.objectId !== input.expectedContainerId
  ) {
    throw new ContainerV2MutationError("Container id mismatch", 400);
  }

  const verifiedEvent = await verifySignedAccessEvent({
    body: input.request.body as KeyingV2CanonicalJson,
    event,
    signerPublicKey: await loadSignerPublicKey(executor, input),
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function assertContainerManifestBundleConsistent(
  bundle: ContainerV2ManifestBundle,
  label: string,
): Promise<VerifiedContainerAccessManifest> {
  const verified = readVerifiedContainerManifest(bundle, label);
  const derivedManifest = await deriveContainerAccessManifest(verified.state);
  const derivedManifestHash = await computeAccessManifestHash(derivedManifest);
  const suppliedManifestHash = await computeAccessManifestHash(
    verified.manifest,
  );

  if (
    verified.manifestHash !== derivedManifestHash ||
    verified.manifestHash !== suppliedManifestHash ||
    !canonicalJsonEquals(derivedManifest, verified.manifest)
  ) {
    throw new ContainerV2MutationError(
      `${label} manifest bundle is not self-consistent`,
      409,
    );
  }

  if (
    verified.manifest.objectKind !== "container" ||
    verified.manifest.objectId !== verified.state.containerId ||
    verified.manifest.organizationId !== verified.state.organizationId ||
    verified.manifest.epoch !== verified.state.epoch ||
    verified.manifest.previousManifestHash !==
      verified.state.previousManifestHash ||
    verified.manifest.eventHash !== verified.state.eventHash ||
    verified.event.eventHash !== verified.state.eventHash ||
    verified.event.event.objectId !== verified.state.containerId ||
    verified.event.event.organizationId !== verified.state.organizationId
  ) {
    throw new ContainerV2MutationError(
      `${label} manifest bundle has inconsistent domains`,
      409,
    );
  }

  return verified;
}

async function getCachedCurrentAccessManifestHead(
  context: ContainerV2MutationContext,
  containerId: string,
): Promise<CurrentAccessManifestHead> {
  if (context.manifestHeadByContainerId.has(containerId)) {
    return context.manifestHeadByContainerId.get(containerId) ?? null;
  }

  const head = await getCurrentAccessManifestHead(
    "container",
    containerId,
    context.executor,
  );
  context.manifestHeadByContainerId.set(containerId, head);
  return head;
}

async function assertManifestHeadCurrent(
  context: ContainerV2MutationContext,
  manifest: VerifiedContainerAccessManifest,
  label: string,
): Promise<void> {
  const head = await getCachedCurrentAccessManifestHead(
    context,
    manifest.state.containerId,
  );

  if (!head) {
    throw new ContainerV2MutationError(`${label} manifest head missing`, 404);
  }

  if (head.manifestHash !== manifest.manifestHash) {
    throw new ContainerV2MutationError(`${label} manifest head is stale`, 409);
  }
}

function assertContainerPathEdges(
  path: readonly VerifiedContainerAccessManifest[],
  label: string,
): void {
  for (let index = 1; index < path.length; index += 1) {
    const parent = path[index - 1];
    const child = path[index];

    if (!parent || !child) {
      continue;
    }

    if (
      child.state.parentContainerId !== parent.state.containerId ||
      child.state.parentManifestHash !== parent.manifestHash
    ) {
      throw new ContainerV2MutationError(
        `${label} does not match container parent edges`,
        409,
      );
    }
  }
}

async function assertCurrentContainerPath(
  context: ContainerV2MutationContext,
  bundles: readonly ContainerV2ManifestBundle[] | undefined,
  label: string,
): Promise<void> {
  if (bundles === undefined) {
    return;
  }

  const path: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of bundles.entries()) {
    const manifest = await assertContainerManifestBundleConsistent(
      bundle,
      `${label}[${index}]`,
    );
    await assertManifestHeadCurrent(context, manifest, `${label}[${index}]`);
    path.push(manifest);
  }

  assertContainerPathEdges(path, label);
}

async function assertHistoricalContainerManifestsConsistent(
  bundles: readonly ContainerV2ManifestBundle[] | undefined,
): Promise<void> {
  if (bundles === undefined) {
    return;
  }

  for (const [index, bundle] of bundles.entries()) {
    await assertContainerManifestBundleConsistent(
      bundle,
      `containerManifestHistory[${index}]`,
    );
  }
}

async function assertMutationHeadCanAdvance(
  context: ContainerV2MutationContext,
  manifest: VerifiedContainerAccessManifest,
): Promise<void> {
  const currentHead = await getCachedCurrentAccessManifestHead(
    context,
    manifest.state.containerId,
  );

  if (manifest.event.event.eventType === "container.create") {
    if (currentHead) {
      throw new ContainerV2MutationError(
        "Container manifest already exists",
        409,
      );
    }
    return;
  }

  if (!currentHead) {
    throw new ContainerV2MutationError("Container manifest head missing", 404);
  }

  if (currentHead.manifestHash !== manifest.state.previousManifestHash) {
    throw new ContainerV2MutationError("Container manifest head is stale", 409);
  }
}

async function assertUserRecipientKeysCurrent(
  executor: DatabaseExecutor,
  userRecipientKeys: readonly ContainerUserRecipientKeyV2[],
): Promise<void> {
  if (userRecipientKeys.length === 0) {
    return;
  }

  for (const key of userRecipientKeys) {
    if (
      typeof key.userId !== "string" ||
      typeof key.recipientKeyEpochId !== "string" ||
      typeof key.recipientKeyFingerprint !== "string"
    ) {
      throw new ContainerV2MutationError("Invalid user recipient key", 400);
    }
  }

  const userIds = [...new Set(userRecipientKeys.map((key) => key.userId))];
  const storedUsers = await executor
    .select({
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      id: users.id,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const storedUserById = new Map(storedUsers.map((user) => [user.id, user]));

  for (const key of userRecipientKeys) {
    const storedUser = storedUserById.get(key.userId);
    if (!storedUser) {
      throw new ContainerV2MutationError("Recipient user not found", 409);
    }

    if (
      storedUser.encapsulationKeyFingerprint !== key.recipientKeyFingerprint
    ) {
      throw new ContainerV2MutationError(
        "Recipient user key fingerprint is stale",
        409,
      );
    }
  }
}

function assertPrincipalPolicyShape(policy: VerifiedPrincipalPolicy): void {
  if (
    typeof policy.principalType !== "string" ||
    typeof policy.principalId !== "string" ||
    typeof policy.version !== "number" ||
    typeof policy.keyEpoch !== "number" ||
    typeof policy.stateHash !== "string" ||
    typeof policy.state?.keyFingerprint !== "string" ||
    !Array.isArray(policy.projection)
  ) {
    throw new ContainerV2MutationError("Invalid principal policy", 400);
  }
}

interface PrincipalPolicyArtifacts {
  readonly currentStateByPolicyKey: Map<string, StoredPrincipalState>;
  readonly projectionByPolicyKey: Map<
    string,
    StoredPrincipalProjectionMember[]
  >;
}

async function loadPrincipalPolicyArtifacts(
  executor: DatabaseExecutor,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): Promise<PrincipalPolicyArtifacts> {
  const currentStateByPolicyKey = new Map<string, StoredPrincipalState>();
  const projectionByPolicyKey = new Map<
    string,
    StoredPrincipalProjectionMember[]
  >();

  for (const principalType of [
    ...new Set(principalPolicies.map((policy) => policy.principalType)),
  ]) {
    const policiesForType = principalPolicies.filter(
      (policy) => policy.principalType === principalType,
    );
    const currentStates = await getCurrentPrincipalStates(
      principalType,
      policiesForType.map((policy) => policy.principalId),
      executor,
    );

    for (const policy of policiesForType) {
      const currentState = currentStates.get(policy.principalId);
      if (currentState) {
        currentStateByPolicyKey.set(principalPolicyKey(policy), currentState);
      }
    }

    const projections = await listPrincipalProjectionMembersForStates(
      principalType,
      [...currentStates.values()],
      executor,
    );

    for (const policy of policiesForType) {
      const currentState = currentStates.get(policy.principalId);
      if (currentState) {
        projectionByPolicyKey.set(
          principalPolicyKey(policy),
          projections.get(principalProjectionStateKey(currentState)) ?? [],
        );
      }
    }
  }

  return { currentStateByPolicyKey, projectionByPolicyKey };
}

function assertPrincipalPolicyStateCurrent(
  policy: VerifiedPrincipalPolicy,
  currentState: StoredPrincipalState | undefined,
): void {
  if (
    !currentState ||
    currentState.version !== policy.version ||
    currentState.keyEpoch !== policy.keyEpoch ||
    currentState.stateHash !== policy.stateHash ||
    currentState.keyFingerprint !== policy.state.keyFingerprint
  ) {
    throw new ContainerV2MutationError("Principal policy is stale", 409);
  }
}

function assertPrincipalPolicyProjectionCurrent(
  policy: VerifiedPrincipalPolicy,
  storedProjection: readonly StoredPrincipalProjectionMember[],
): void {
  const storedProjectionKeys = storedProjection.map(projectionMemberKey).sort();
  const policyProjectionKeys = policy.projection
    .map(projectionMemberKey)
    .sort();

  if (
    storedProjectionKeys.length !== policyProjectionKeys.length ||
    storedProjectionKeys.some(
      (storedKey, index) => storedKey !== policyProjectionKeys[index],
    )
  ) {
    throw new ContainerV2MutationError(
      "Principal policy projection is stale",
      409,
    );
  }
}

async function assertPrincipalPoliciesCurrent(
  executor: DatabaseExecutor,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): Promise<void> {
  for (const policy of principalPolicies) {
    assertPrincipalPolicyShape(policy);
  }

  const artifacts = await loadPrincipalPolicyArtifacts(
    executor,
    principalPolicies,
  );

  for (const policy of principalPolicies) {
    const key = principalPolicyKey(policy);
    assertPrincipalPolicyStateCurrent(
      policy,
      artifacts.currentStateByPolicyKey.get(key),
    );
    assertPrincipalPolicyProjectionCurrent(
      policy,
      artifacts.projectionByPolicyKey.get(key) ?? [],
    );
  }
}

async function assertParentKekStateCurrent(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
  parentKekState: VerifiedContainerKekState | null,
): Promise<void> {
  if (!manifest.state.parentContainerId) {
    return;
  }

  if (!parentKekState) {
    throw new ContainerV2MutationError("Parent KEK state is required", 409);
  }

  if (parentKekState.containerId !== manifest.state.parentContainerId) {
    throw new ContainerV2MutationError(
      "Parent KEK state container mismatch",
      409,
    );
  }

  const currentParentEpoch = await getCurrentContainerKeyEpoch(
    parentKekState.containerId,
    executor,
  );
  if (!currentParentEpoch) {
    throw new ContainerV2MutationError("Parent KEK state missing", 404);
  }

  const currentParentKeyEpoch = toContainerKeyEpoch(currentParentEpoch);
  const currentParentKeyEpochHash = await computeContainerKeyEpochHash(
    currentParentKeyEpoch,
  );

  if (
    parentKekState.containerKeyEpochId !== currentParentKeyEpoch.id ||
    parentKekState.keyEpochHash !== currentParentKeyEpochHash ||
    !canonicalJsonEquals(parentKekState.keyEpoch, currentParentKeyEpoch)
  ) {
    throw new ContainerV2MutationError("Parent KEK state is stale", 409);
  }
}

async function verifyContainerManifestFromRequest(
  request: ContainerV2MutationRequest,
  event: Awaited<ReturnType<typeof verifyMutationEvent>>,
): Promise<VerifiedContainerAccessManifest> {
  const destinationParentContainerPath = readVerifiedContainerManifestArray(
    request.destinationParentContainerPath,
    "destinationParentContainerPath",
  );
  const parentContainerPath = readVerifiedContainerManifestArray(
    request.parentContainerPath,
    "parentContainerPath",
  );
  const previousContainerPath = readVerifiedContainerManifestArray(
    request.previousContainerPath,
    "previousContainerPath",
  );
  const result = await verifyContainerAccessManifest({
    event,
    expectedManifestHash: request.expectedManifestHash,
    manifest: readProjectionAccessManifest(
      request.manifest,
      "Container V2 mutation manifest",
      mutationShapeError,
    ),
    previousManifest:
      request.previousManifest === undefined
        ? null
        : request.previousManifest === null
          ? null
          : readVerifiedContainerManifest(
              request.previousManifest,
              "previousManifest",
            ),
    principalPolicies: principalPoliciesFromRequest(request),
    ...(destinationParentContainerPath !== undefined
      ? { destinationParentContainerPath }
      : {}),
    ...(parentContainerPath !== undefined ? { parentContainerPath } : {}),
    ...(previousContainerPath !== undefined ? { previousContainerPath } : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function appendPathManifestHashes(
  hashes: string[],
  path: readonly ContainerV2ManifestBundle[] | undefined,
): void {
  if (!path) {
    return;
  }

  for (const manifest of path) {
    hashes.push(manifest.manifestHash);
  }
}

function expectedAccessEventDependencyHashes(
  request: ContainerV2MutationRequest,
  eventType: AccessEventTypeV2,
): string[] {
  const hashes: string[] = [];

  if (eventType === "container.create") {
    appendPathManifestHashes(hashes, request.parentContainerPath);
  } else {
    if (request.previousManifest) {
      hashes.push(request.previousManifest.manifestHash);
    }
    appendPathManifestHashes(hashes, request.previousContainerPath);

    if (eventType === "container.move") {
      appendPathManifestHashes(hashes, request.destinationParentContainerPath);
    }
  }

  return [...new Set(hashes)].sort();
}

function assertAccessEventDependenciesMatchRequest(
  request: ContainerV2MutationRequest,
  event: Awaited<ReturnType<typeof verifyMutationEvent>>,
): void {
  const expected = expectedAccessEventDependencyHashes(
    request,
    event.event.eventType,
  );
  const actual = [...event.event.dependencyManifestHashes].sort();

  if (
    expected.length !== actual.length ||
    expected.some((dependencyHash, index) => dependencyHash !== actual[index])
  ) {
    throw new ContainerV2MutationError(
      "Access event dependency hashes do not match supplied manifests",
      409,
    );
  }
}

async function verifyContainerKekFromRequest(
  executor: DatabaseExecutor,
  request: ContainerV2MutationRequest,
  manifest: VerifiedContainerAccessManifest,
): Promise<VerifiedContainerKekState> {
  const userRecipientKeys = userRecipientKeysFromRequest(request);
  const parentKekState =
    request.parentKekState === undefined || request.parentKekState === null
      ? null
      : readVerifiedContainerKekState(request.parentKekState, "parentKekState");

  await assertUserRecipientKeysCurrent(executor, userRecipientKeys);
  await assertParentKekStateCurrent(executor, manifest, parentKekState);

  const containerManifestHistory = readVerifiedContainerManifestArray(
    request.containerManifestHistory,
    "containerManifestHistory",
  );
  const result = await verifyContainerKekState({
    containerManifest: manifest,
    keyEpoch: readContainerKeyEpoch(request.keyEpoch, "keyEpoch"),
    parentKekState,
    principalPolicies: principalPoliciesFromRequest(request),
    userRecipientKeys,
    wraps: readContainerKeyWraps(request.wraps, "wraps"),
    ...(containerManifestHistory !== undefined
      ? { containerManifestHistory }
      : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

async function loadContainerRow(
  executor: DatabaseExecutor,
  containerId: string,
): Promise<StoredContainerRow | null> {
  const [row] = await executor
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  return row ?? null;
}

async function assertMetadataDocumentAvailable(
  executor: DatabaseExecutor,
  metadataDocumentId: string,
): Promise<void> {
  const [existingMetadataDocument] = await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, metadataDocumentId))
    .limit(1);
  if (existingMetadataDocument) {
    throw new ContainerV2MutationError(
      "Container metadata document already exists",
      409,
    );
  }
}

async function insertContainerMetadataBinding(
  executor: DatabaseExecutor,
  state: VerifiedContainerAccessState,
): Promise<void> {
  const [metadataBinding] = await executor
    .insert(containerMetadataDocuments)
    .values({
      containerId: state.containerId,
      documentId: state.metadataDocumentId,
    })
    .onConflictDoNothing()
    .returning({ containerId: containerMetadataDocuments.containerId });
  if (!metadataBinding) {
    throw new ContainerV2MutationError(
      "Container metadata binding already exists",
      409,
    );
  }
}

async function persistCreatedContainerStructure(
  executor: DatabaseExecutor,
  state: VerifiedContainerAccessState,
): Promise<void> {
  if (!state.parentContainerId) {
    throw new ContainerV2MutationError(
      "V2 container create requires a parent",
      400,
    );
  }

  const parent = await loadContainerRow(executor, state.parentContainerId);
  if (!parent) {
    throw new ContainerV2MutationError("Parent container not found", 404);
  }

  if (parent.organizationId !== state.organizationId) {
    throw new ContainerV2MutationError(
      "Parent container organization mismatch",
      409,
    );
  }

  await assertMetadataDocumentAvailable(executor, state.metadataDocumentId);

  const [inserted] = await executor
    .insert(containers)
    .values({
      id: state.containerId,
      organizationId: state.organizationId,
      parentId: state.parentContainerId,
    })
    .onConflictDoNothing({ target: containers.id })
    .returning({ id: containers.id });

  if (!inserted) {
    throw new ContainerV2MutationError("Container already exists", 409);
  }

  await insertContainerMetadataBinding(executor, state);
}

async function persistContainerStructure(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
): Promise<void> {
  const state = manifest.state;

  if (manifest.event.event.eventType === "container.create") {
    await persistCreatedContainerStructure(executor, state);
    return;
  }

  const container = await loadContainerRow(executor, state.containerId);
  if (!container) {
    throw new ContainerV2MutationError("Container not found", 404);
  }

  if (container.organizationId !== state.organizationId) {
    throw new ContainerV2MutationError("Container organization mismatch", 409);
  }

  if (manifest.event.event.eventType !== "container.move") {
    return;
  }

  if (!container.parentId) {
    throw new ContainerV2MutationError("Root container cannot be moved", 400);
  }

  if (!state.parentContainerId) {
    throw new ContainerV2MutationError(
      "Destination parent container is required",
      400,
    );
  }

  const destinationParent = await loadContainerRow(
    executor,
    state.parentContainerId,
  );
  if (!destinationParent) {
    throw new ContainerV2MutationError(
      "Destination parent container not found",
      404,
    );
  }

  if (destinationParent.organizationId !== state.organizationId) {
    throw new ContainerV2MutationError(
      "Destination parent organization mismatch",
      409,
    );
  }

  await executor
    .update(containers)
    .set({ parentId: state.parentContainerId })
    .where(eq(containers.id, state.containerId));
}

async function persistVerifiedMutation(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
): Promise<ContainerV2MutationResponse> {
  await persistContainerStructure(executor, manifest);

  const manifestHead = await runConflictBoundary(() =>
    storeVerifiedAccessManifest({ verifiedManifest: manifest }, executor),
  );
  if (manifestHead.manifestHash !== manifest.manifestHash) {
    throw new ContainerV2MutationError("Container manifest head is stale", 409);
  }

  const storedKekState = await runConflictBoundary(() =>
    storeVerifiedContainerKekState({ verifiedState: kekState }, executor),
  );

  return {
    containerId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    parentId: manifest.state.parentContainerId,
    manifestHead: {
      epoch: manifestHead.epoch,
      manifestHash: manifestHead.manifestHash,
    },
    accessManifest: {
      event: projectionVerifiedAccessEventRecord(manifest.event),
      manifest: projectionAccessManifestRecord(manifest.manifest),
      manifestHash: manifest.manifestHash,
      state: containerAccessStateRecord(manifest.state),
    },
    containerKek: {
      containerId: storedKekState.containerId,
      accessManifestHash: storedKekState.accessManifestHash,
      containerKeyEpochId: storedKekState.containerKeyEpochId,
      containerKeyEpoch: storedKekState.containerKeyEpoch,
      keyEpoch: containerKeyEpochRecord(storedKekState.keyEpoch),
      keyEpochHash: storedKekState.keyEpochHash,
      keyTargetHash: storedKekState.keyTargetHash,
      parentContainerKeyEpochId: storedKekState.parentContainerKeyEpochId,
      recipientTargets: storedKekState.recipientTargets.map(
        containerKekRecipientTargetRecord,
      ),
      wraps: storedKekState.wraps.map(containerKeyWrapRecord),
    },
    referencedPrincipalHeads: manifest.manifest.referencedPrincipalHeads.map(
      referencedPrincipalHeadRecord,
    ),
  };
}

async function mutateContainerV2WithExecutor(
  input: MutateContainerV2WithExecutorInput,
): Promise<ContainerV2MutationResponse> {
  const context: ContainerV2MutationContext = {
    executor: input.executor,
    manifestHeadByContainerId: new Map(),
  };

  await assertCurrentContainerPath(
    context,
    input.request.previousContainerPath,
    "previousContainerPath",
  );
  await assertCurrentContainerPath(
    context,
    input.request.parentContainerPath,
    "parentContainerPath",
  );
  await assertCurrentContainerPath(
    context,
    input.request.destinationParentContainerPath,
    "destinationParentContainerPath",
  );
  await assertHistoricalContainerManifestsConsistent(
    input.request.containerManifestHistory,
  );
  if (input.request.previousManifest) {
    const previousManifest = await assertContainerManifestBundleConsistent(
      input.request.previousManifest,
      "previousManifest",
    );
    await assertManifestHeadCurrent(
      context,
      previousManifest,
      "previousManifest",
    );
  }
  await assertPrincipalPoliciesCurrent(
    input.executor,
    principalPoliciesFromRequest(input.request),
  );

  const event = await verifyMutationEvent(input.executor, input);
  assertAccessEventDependenciesMatchRequest(input.request, event);
  const manifest = await verifyContainerManifestFromRequest(
    input.request,
    event,
  );
  await assertMutationHeadCanAdvance(context, manifest);
  const kekState = await verifyContainerKekFromRequest(
    input.executor,
    input.request,
    manifest,
  );

  return persistVerifiedMutation(input.executor, manifest, kekState);
}

export async function applyContainerV2Rekeys(input: {
  readonly executor: DatabaseExecutor;
  readonly fingerprint: string;
  readonly requests?: readonly ContainerV2MutationRequest[] | undefined;
  readonly userId: string;
}): Promise<void> {
  if (!input.requests || input.requests.length === 0) {
    return;
  }

  // Document/blob writes call this before resolving current container heads and
  // KEK targets. A retry can carry the same signed container.rekey that would
  // have gone through /rekey, then validate the actual write against the new
  // head in this transaction; if the write later fails, the rekey rolls back too.
  for (const request of input.requests) {
    await mutateContainerV2WithExecutor({
      executor: input.executor,
      expectedEventType: "container.rekey",
      fingerprint: input.fingerprint,
      request,
      userId: input.userId,
    });
  }
}

export async function mutateContainerV2(
  runtime: ApiServiceRuntime,
  input: MutateContainerV2Input,
): Promise<ContainerV2MutationResponse> {
  try {
    return await runtime.db.transaction((tx) =>
      mutateContainerV2WithExecutor({
        ...input,
        executor: tx,
      }),
    );
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }

    throw error;
  }
}
