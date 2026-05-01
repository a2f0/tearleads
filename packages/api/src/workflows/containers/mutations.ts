import type {
  AccessEventType,
  AccessManifest,
  AccessManifestCheckpoint,
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerGrantSubjectType,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  KeyingCanonicalJson,
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
  PrincipalPolicySignedState,
  PrincipalProjectionMember,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  KeyingVerificationError,
  serializeKeyingCanonicalJson,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  ContainerManifestBundle,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { eq, inArray } from "drizzle-orm";
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";
import { getCurrentContainerKeyEpoch } from "../../access/read/containerKekStore";
import {
  getCurrentPrincipalStates,
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { storeVerifiedAccessManifest } from "../../access/write/accessManifestStore";
import { storeVerifiedContainerKekState } from "../../access/write/containerKekStore";
import type {
  db as apiDatabase,
  DatabaseExecutor,
} from "../../adapters/postgres";
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
  readProjectionVersion,
} from "../../keyingProjectionRecords";
import {
  containerMetadataDocuments,
  containers,
  documents,
  users,
} from "../../schema";

type ContainerMutationStatus = 400 | 403 | 404 | 409;
type ApiDatabase = typeof apiDatabase;

export class ContainerMutationError extends Error {
  constructor(
    message: string,
    readonly status: ContainerMutationStatus,
  ) {
    super(message);
    this.name = "ContainerMutationError";
  }
}

export interface MutateContainerInput {
  readonly expectedContainerId?: string;
  readonly expectedEventType: AccessEventType;
  readonly fingerprint: string;
  readonly request: ContainerMutationRequest;
  readonly userId: string;
}

interface MutateContainerWithExecutorInput extends MutateContainerInput {
  readonly context?: ContainerMutationContext;
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

interface ContainerMutationContext {
  readonly executor: DatabaseExecutor;
  readonly manifestHeadByContainerId: Map<string, CurrentAccessManifestHead>;
}

function mutationShapeError(message: string): ContainerMutationError {
  return new ContainerMutationError(message, 400);
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

function isManagedPrincipalKind(value: unknown): value is ManagedPrincipalKind {
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

function isContainerAccessLevel(value: unknown): value is ContainerAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerGrantSubjectType {
  return value === "group" || value === "organization" || value === "user";
}

function isKekRecipientKind(
  value: unknown,
): value is ContainerKeyWrap["recipientKind"] {
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
): ContainerDirectGrant {
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
): ContainerDirectGrant[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerDirectGrant(entry, `${label}[${index}]`),
  );
}

function referencedPrincipalHeadRecord(
  principalHead: ReferencedPrincipalHead,
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
): ContainerAccessManifestState {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  readProjectionVersion(record, label, mutationShapeError);

  return {
    version: 1,
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
  state: ContainerAccessManifestState,
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
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
}): AccessManifestCheckpoint {
  return {
    objectKind: input.manifest.objectKind,
    objectId: input.manifest.objectId,
    organizationId: input.manifest.organizationId,
    epoch: input.manifest.epoch,
    manifestHash: input.manifestHash,
  };
}

function readVerifiedContainerManifest(
  bundle: ContainerManifestBundle,
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
  bundles: readonly ContainerManifestBundle[] | undefined,
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
): PrincipalPolicySignedState {
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
): PrincipalPolicyCheckpoint {
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
  request: ContainerMutationRequest,
): VerifiedPrincipalPolicy[] {
  return (request.principalPolicies ?? []).map((policy, index) =>
    readVerifiedPrincipalPolicy(policy, `principalPolicies[${index}]`),
  );
}

function userRecipientKeysFromRequest(
  request: ContainerMutationRequest,
): ContainerUserRecipientKey[] {
  return (request.userRecipientKeys ?? []).map((key, index) =>
    readContainerUserRecipientKey(key, `userRecipientKeys[${index}]`),
  );
}

function readContainerUserRecipientKey(
  value: unknown,
  label: string,
): ContainerUserRecipientKey {
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
): ContainerKeyEpoch {
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
  keyEpoch: ContainerKeyEpoch,
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

function readContainerKeyWrap(value: unknown, label: string): ContainerKeyWrap {
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
): ContainerKeyWrap[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerKeyWrap(entry, `${label}[${index}]`),
  );
}

function containerKeyWrapRecord(
  wrap: ContainerKeyWrap,
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
): ContainerKekRecipientTarget {
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
): ContainerKekRecipientTarget[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerKekRecipientTarget(entry, `${label}[${index}]`),
  );
}

function containerKekRecipientTargetRecord(
  target: ContainerKekRecipientTarget,
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
    serializeKeyingCanonicalJson(left as KeyingCanonicalJson) ===
    serializeKeyingCanonicalJson(right as KeyingCanonicalJson)
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
  keyEpoch: ContainerKeyEpoch & { readonly createdAt?: Date },
): ContainerKeyEpoch {
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
  error: KeyingVerificationError,
): ContainerMutationStatus {
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

function toMutationError(error: unknown): ContainerMutationError | null {
  if (error instanceof ContainerMutationError) {
    return error;
  }

  if (error instanceof KeyingVerificationError) {
    return new ContainerMutationError(
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
      error instanceof ContainerMutationError ||
      error instanceof KeyingVerificationError
    ) {
      throw error;
    }

    throw new ContainerMutationError(
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
    throw new ContainerMutationError("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}

async function verifyMutationEvent(
  executor: DatabaseExecutor,
  input: MutateContainerInput,
) {
  const event = readProjectionAccessEvent(
    input.request.event,
    "Container mutation event",
    mutationShapeError,
  );

  if (
    event.signerUserId !== input.userId ||
    event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new ContainerMutationError("Forbidden", 403);
  }

  if (event.eventType !== input.expectedEventType) {
    throw new ContainerMutationError("Unexpected container event type", 400);
  }

  if (
    input.expectedContainerId !== undefined &&
    event.objectId !== input.expectedContainerId
  ) {
    throw new ContainerMutationError("Container id mismatch", 400);
  }

  const verifiedEvent = await verifySignedAccessEvent({
    body: input.request.body as KeyingCanonicalJson,
    event,
    signerPublicKey: await loadSignerPublicKey(executor, input),
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function assertContainerManifestBundleConsistent(
  bundle: ContainerManifestBundle,
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
    throw new ContainerMutationError(
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
    throw new ContainerMutationError(
      `${label} manifest bundle has inconsistent domains`,
      409,
    );
  }

  return verified;
}

async function getCachedCurrentAccessManifestHead(
  context: ContainerMutationContext,
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
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
  label: string,
): Promise<void> {
  const head = await getCachedCurrentAccessManifestHead(
    context,
    manifest.state.containerId,
  );

  if (!head) {
    throw new ContainerMutationError(`${label} manifest head missing`, 404);
  }

  if (head.manifestHash !== manifest.manifestHash) {
    throw new ContainerMutationError(`${label} manifest head is stale`, 409);
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
      throw new ContainerMutationError(
        `${label} does not match container parent edges`,
        409,
      );
    }
  }
}

async function assertCurrentContainerPath(
  context: ContainerMutationContext,
  bundles: readonly ContainerManifestBundle[] | undefined,
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
  bundles: readonly ContainerManifestBundle[] | undefined,
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
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
): Promise<void> {
  const currentHead = await getCachedCurrentAccessManifestHead(
    context,
    manifest.state.containerId,
  );

  if (manifest.event.event.eventType === "container.create") {
    if (currentHead) {
      throw new ContainerMutationError(
        "Container manifest already exists",
        409,
      );
    }
    return;
  }

  if (!currentHead) {
    throw new ContainerMutationError("Container manifest head missing", 404);
  }

  if (currentHead.manifestHash !== manifest.state.previousManifestHash) {
    throw new ContainerMutationError("Container manifest head is stale", 409);
  }
}

async function assertUserRecipientKeysCurrent(
  executor: DatabaseExecutor,
  userRecipientKeys: readonly ContainerUserRecipientKey[],
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
      throw new ContainerMutationError("Invalid user recipient key", 400);
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
      throw new ContainerMutationError("Recipient user not found", 409);
    }

    if (
      storedUser.encapsulationKeyFingerprint !== key.recipientKeyFingerprint
    ) {
      throw new ContainerMutationError(
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
    throw new ContainerMutationError("Invalid principal policy", 400);
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
    throw new ContainerMutationError("Principal policy is stale", 409);
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
    throw new ContainerMutationError(
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
    throw new ContainerMutationError("Parent KEK state is required", 409);
  }

  if (parentKekState.containerId !== manifest.state.parentContainerId) {
    throw new ContainerMutationError(
      "Parent KEK state container mismatch",
      409,
    );
  }

  const currentParentEpoch = await getCurrentContainerKeyEpoch(
    parentKekState.containerId,
    executor,
  );
  if (!currentParentEpoch) {
    throw new ContainerMutationError("Parent KEK state missing", 404);
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
    throw new ContainerMutationError("Parent KEK state is stale", 409);
  }
}

async function verifyContainerManifestFromRequest(
  request: ContainerMutationRequest,
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
      "Container mutation manifest",
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
  path: readonly ContainerManifestBundle[] | undefined,
): void {
  if (!path) {
    return;
  }

  for (const manifest of path) {
    hashes.push(manifest.manifestHash);
  }
}

function expectedAccessEventDependencyHashes(
  request: ContainerMutationRequest,
  eventType: AccessEventType,
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
  request: ContainerMutationRequest,
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
    throw new ContainerMutationError(
      "Access event dependency hashes do not match supplied manifests",
      409,
    );
  }
}

async function verifyContainerKekFromRequest(
  executor: DatabaseExecutor,
  request: ContainerMutationRequest,
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
    throw new ContainerMutationError(
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
    throw new ContainerMutationError(
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
    throw new ContainerMutationError("container create requires a parent", 400);
  }

  const parent = await loadContainerRow(executor, state.parentContainerId);
  if (!parent) {
    throw new ContainerMutationError("Parent container not found", 404);
  }

  if (parent.organizationId !== state.organizationId) {
    throw new ContainerMutationError(
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
    throw new ContainerMutationError("Container already exists", 409);
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
    throw new ContainerMutationError("Container not found", 404);
  }

  if (container.organizationId !== state.organizationId) {
    throw new ContainerMutationError("Container organization mismatch", 409);
  }

  if (manifest.event.event.eventType !== "container.move") {
    return;
  }

  if (!container.parentId) {
    throw new ContainerMutationError("Root container cannot be moved", 400);
  }

  if (!state.parentContainerId) {
    throw new ContainerMutationError(
      "Destination parent container is required",
      400,
    );
  }

  const destinationParent = await loadContainerRow(
    executor,
    state.parentContainerId,
  );
  if (!destinationParent) {
    throw new ContainerMutationError(
      "Destination parent container not found",
      404,
    );
  }

  if (destinationParent.organizationId !== state.organizationId) {
    throw new ContainerMutationError(
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
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
): Promise<ContainerMutationResponse> {
  const { executor } = context;

  await persistContainerStructure(executor, manifest);

  const manifestHead = await runConflictBoundary(() =>
    storeVerifiedAccessManifest({ verifiedManifest: manifest }, executor),
  );
  if (manifestHead.manifestHash !== manifest.manifestHash) {
    throw new ContainerMutationError("Container manifest head is stale", 409);
  }
  context.manifestHeadByContainerId.set(
    manifest.state.containerId,
    manifestHead,
  );

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

async function mutateContainerWithExecutor(
  input: MutateContainerWithExecutorInput,
): Promise<ContainerMutationResponse> {
  const context: ContainerMutationContext = input.context ?? {
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
    context.executor,
    principalPoliciesFromRequest(input.request),
  );

  const event = await verifyMutationEvent(context.executor, input);
  assertAccessEventDependenciesMatchRequest(input.request, event);
  const manifest = await verifyContainerManifestFromRequest(
    input.request,
    event,
  );
  await assertMutationHeadCanAdvance(context, manifest);
  const kekState = await verifyContainerKekFromRequest(
    context.executor,
    input.request,
    manifest,
  );

  return persistVerifiedMutation(context, manifest, kekState);
}

export async function applyContainerRekeys(input: {
  readonly executor: DatabaseExecutor;
  readonly fingerprint: string;
  readonly requests?: readonly ContainerMutationRequest[] | undefined;
  readonly userId: string;
}): Promise<void> {
  if (!input.requests || input.requests.length === 0) {
    return;
  }

  // Document/blob writes call this before resolving current container heads and
  // KEK targets. A retry can carry the same signed container.rekey that would
  // have gone through /rekey, then validate the actual write against the new
  // head in this transaction; if the write later fails, the rekey rolls back too.
  const context: ContainerMutationContext = {
    executor: input.executor,
    manifestHeadByContainerId: new Map(),
  };

  for (const request of input.requests) {
    await mutateContainerWithExecutor({
      context,
      executor: input.executor,
      expectedEventType: "container.rekey",
      fingerprint: input.fingerprint,
      request,
      userId: input.userId,
    });
  }
}

export async function runContainerMutationWorkflow(
  db: ApiDatabase,
  input: MutateContainerInput,
): Promise<ContainerMutationResponse> {
  try {
    return await db.transaction((tx) =>
      mutateContainerWithExecutor({
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
