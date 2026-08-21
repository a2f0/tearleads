import type {
  ManagedPrincipalKind,
  PrincipalContainerGrant,
  PrincipalPolicyCheckpoint,
  PrincipalPolicySignedState,
  PrincipalProjectionMember,
  PrincipalStateExternalAuthority,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import {
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionString,
  readProjectionValue,
} from "../../../../keyingProjectionRecords";
import { mutationShapeError } from "../errors";

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

function isPrincipalProjectionRole(
  value: unknown,
): value is PrincipalProjectionMember["role"] {
  return value === "admin" || value === "member";
}

function readPrincipalProjectionMember(
  value: unknown,
  label: string,
): PrincipalProjectionMember {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const role = readProjectionValue(record, "role");

  if (!isPrincipalProjectionRole(role)) {
    throw mutationShapeError(`${label}.role is invalid`);
  }

  return {
    userId: readProjectionString(record, "userId", label, mutationShapeError),
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

function readPrincipalContainerGrants(
  value: unknown,
  label: string,
): PrincipalContainerGrant[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const record = readProjectionPlainRecord(
      entry,
      itemLabel,
      mutationShapeError,
    );
    const accessLevel = readProjectionValue(record, "accessLevel");
    if (
      accessLevel !== "admin" &&
      accessLevel !== "read" &&
      accessLevel !== "write"
    ) {
      throw mutationShapeError(`${itemLabel}.accessLevel is invalid`);
    }
    return {
      accessLevel,
      containerId: readProjectionString(
        record,
        "containerId",
        itemLabel,
        mutationShapeError,
      ),
    };
  });
}

function readExternalAuthority(
  value: unknown,
  label: string,
): PrincipalStateExternalAuthority | null {
  if (value === null) {
    return null;
  }
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  if (readProjectionValue(record, "principalType") !== "group") {
    throw mutationShapeError(`${label}.principalType is invalid`);
  }
  return {
    principalType: "group",
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
    keyFingerprint: readProjectionString(
      record,
      "keyFingerprint",
      label,
      mutationShapeError,
    ),
  };
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
    memberEnvelopesRoot: readStringField("memberEnvelopesRoot"),
    projectionRoot: readStringField("projectionRoot"),
    grantRoot: readStringField("grantRoot"),
    payloadCiphertextHash: readStringField("payloadCiphertextHash"),
    memberCount: readNonNegativeInteger(record, "memberCount", label),
    grantCount: readNonNegativeInteger(record, "grantCount", label),
    externalAuthority: readExternalAuthority(
      readProjectionValue(record, "externalAuthority"),
      `${label}.externalAuthority`,
    ),
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

export type PrincipalPolicyRequestArtifact = Pick<
  VerifiedPrincipalPolicy,
  | "checkpoint"
  | "grants"
  | "keyEpoch"
  | "principalId"
  | "principalType"
  | "projection"
  | "state"
  | "stateHash"
  | "version"
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

function readPrincipalPolicyRequestArtifact(
  value: unknown,
  label: string,
): PrincipalPolicyRequestArtifact {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const principalType = readProjectionValue(record, "principalType");
  if (!isManagedPrincipalKind(principalType)) {
    throw mutationShapeError(`${label}.principalType is invalid`);
  }

  const state = readPrincipalPolicyState(
    readProjectionValue(record, "state"),
    `${label}.state`,
  );
  const policy: PrincipalPolicyRequestArtifact = {
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
    grants: readPrincipalContainerGrants(
      readProjectionValue(record, "grants"),
      `${label}.grants`,
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

  return policy;
}

export function principalPoliciesFromRequest(
  request: ContainerMutationRequest,
): PrincipalPolicyRequestArtifact[] {
  return request.principalPolicies.map((policy, index) =>
    readPrincipalPolicyRequestArtifact(policy, `principalPolicies[${index}]`),
  );
}
