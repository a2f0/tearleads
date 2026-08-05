import type {
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
} from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import { readCanonicalRecord } from "../../keyingCanonicalJson";
import {
  readRecordNullableString,
  readRecordPositiveInteger,
  readRecordString,
  readRecordValue,
} from "../../recordReaders";

function readRecordVersion(
  record: Record<string, unknown>,
  label: string,
): void {
  if (readRecordPositiveInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
}

export function readCanonicalManifestBundle(
  value: unknown,
  label: string,
): AccessManifestBundleWire {
  const record = readCanonicalRecord(value, label);
  return {
    event: readCanonicalRecord(
      readRecordValue(record, "event"),
      `${label}.event`,
    ),
    manifest: readCanonicalRecord(
      readRecordValue(record, "manifest"),
      `${label}.manifest`,
    ),
    manifestHash: readRecordString(record, "manifestHash", label),
    state: readCanonicalRecord(
      readRecordValue(record, "state"),
      `${label}.state`,
    ),
  };
}

function isContainerAccessLevel(
  value: unknown,
): value is ContainerDirectGrant["accessLevel"] {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerDirectGrant["subjectType"] {
  return value === "group" || value === "organization" || value === "user";
}

function isManagedPrincipalKind(
  value: unknown,
): value is ContainerAccessManifestState["referencedPrincipalHeads"][number]["principalType"] {
  return value === "group" || value === "organization";
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
  const record = readCanonicalRecord(value, label);
  const accessLevel = readRecordValue(record, "accessLevel");
  const subjectType = readRecordValue(record, "subjectType");
  if (!isContainerAccessLevel(accessLevel)) {
    throw new Error(`${label}.accessLevel is invalid`);
  }
  if (!isContainerGrantSubjectType(subjectType)) {
    throw new Error(`${label}.subjectType is invalid`);
  }

  return {
    accessLevel,
    subjectId: readRecordString(record, "subjectId", label),
    subjectType,
  };
}

function readContainerDirectGrants(
  value: unknown,
  label: string,
): ContainerDirectGrant[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((grant, index) =>
    readContainerDirectGrant(grant, `${label}[${index}]`),
  );
}

function readReferencedPrincipalHead(
  value: unknown,
  label: string,
): ContainerAccessManifestState["referencedPrincipalHeads"][number] {
  const record = readCanonicalRecord(value, label);
  const principalType = readRecordValue(record, "principalType");
  if (!isManagedPrincipalKind(principalType)) {
    throw new Error(`${label}.principalType is invalid`);
  }

  return {
    principalType,
    principalId: readRecordString(record, "principalId", label),
    version: readRecordPositiveInteger(record, "version", label),
    keyEpoch: readRecordPositiveInteger(record, "keyEpoch", label),
    stateHash: readRecordString(record, "stateHash", label),
    keyFingerprint: readRecordString(record, "keyFingerprint", label),
  };
}

function readReferencedPrincipalHeads(
  value: unknown,
  label: string,
): ContainerAccessManifestState["referencedPrincipalHeads"] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((head, index) =>
    readReferencedPrincipalHead(head, `${label}[${index}]`),
  );
}

export function readContainerAccessManifestState(
  value: unknown,
  label: string,
): ContainerAccessManifestState {
  const record = readCanonicalRecord(value, label);
  readRecordVersion(record, label);

  return {
    version: 1,
    containerId: readRecordString(record, "containerId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordPositiveInteger(record, "epoch", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    eventHash: readRecordString(record, "eventHash", label),
    parentContainerId: readRecordNullableString(
      record,
      "parentContainerId",
      label,
    ),
    parentManifestHash: readRecordNullableString(
      record,
      "parentManifestHash",
      label,
    ),
    metadataDocumentId: readRecordString(record, "metadataDocumentId", label),
    containerKeyEpochId: readRecordNullableString(
      record,
      "containerKeyEpochId",
      label,
    ),
    directGrants: readContainerDirectGrants(
      readRecordValue(record, "directGrants"),
      `${label}.directGrants`,
    ),
    referencedPrincipalHeads: readReferencedPrincipalHeads(
      readRecordValue(record, "referencedPrincipalHeads"),
      `${label}.referencedPrincipalHeads`,
    ),
  };
}

export function readContainerKeyEpoch(
  value: unknown,
  label: string,
): ContainerKeyEpoch {
  const record = readCanonicalRecord(value, label);
  return {
    id: readRecordString(record, "id", label),
    containerId: readRecordString(record, "containerId", label),
    keyEpoch: readRecordPositiveInteger(record, "keyEpoch", label),
    accessManifestHash: readRecordString(record, "accessManifestHash", label),
    parentContainerKeyEpochId: readRecordNullableString(
      record,
      "parentContainerKeyEpochId",
      label,
    ),
    createdByEventHash: readRecordString(record, "createdByEventHash", label),
    createdByManifestHash: readRecordString(
      record,
      "createdByManifestHash",
      label,
    ),
  };
}

function readContainerKeyWrap(value: unknown, label: string): ContainerKeyWrap {
  const record = readCanonicalRecord(value, label);
  const recipientKind = readRecordValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw new Error(`${label}.recipientKind is invalid`);
  }

  return {
    containerKeyEpochId: readRecordString(record, "containerKeyEpochId", label),
    recipientKind,
    recipientId: readRecordString(record, "recipientId", label),
    recipientKeyEpochId: readRecordString(record, "recipientKeyEpochId", label),
    recipientKeyFingerprint: readRecordString(
      record,
      "recipientKeyFingerprint",
      label,
    ),
    kemCipherText: readRecordString(record, "kemCipherText", label),
    wrappedKey: readRecordString(record, "wrappedKey", label),
    wrapManifestHash: readRecordString(record, "wrapManifestHash", label),
  };
}

export function readContainerKeyWraps(
  value: unknown,
  label: string,
): ContainerKeyWrap[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((wrap, index) =>
    readContainerKeyWrap(wrap, `${label}[${index}]`),
  );
}

function readContainerKekRecipientTarget(
  value: unknown,
  label: string,
): ContainerKekRecipientTarget {
  const record = readCanonicalRecord(value, label);
  const recipientKind = readRecordValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw new Error(`${label}.recipientKind is invalid`);
  }

  return {
    recipientKind,
    recipientId: readRecordString(record, "recipientId", label),
    recipientKeyEpochId: readRecordString(record, "recipientKeyEpochId", label),
    recipientKeyFingerprint: readRecordString(
      record,
      "recipientKeyFingerprint",
      label,
    ),
  };
}

export function readContainerKekRecipientTargets(
  value: unknown,
  label: string,
): ContainerKekRecipientTarget[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((target, index) =>
    readContainerKekRecipientTarget(target, `${label}[${index}]`),
  );
}
