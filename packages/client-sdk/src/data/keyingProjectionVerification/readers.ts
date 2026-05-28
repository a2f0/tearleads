import type {
  AccessEvent,
  AccessManifest,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  DocumentLinkAccessEventBody,
  DocumentUnlinkAccessEventBody,
} from "@tearleads/crypto";
import { readCanonicalRecord } from "../keyingCanonicalJson";

export function readRecordString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

export function readRecordNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string or null`);
  }
  return value;
}

function readRecordPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}.${key} must be a positive integer`);
  }
  return value;
}

export function readRecordValue(
  record: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  if (!Reflect.has(record, key)) {
    throw new Error(`${label}.${key} is missing`);
  }
  return record[key];
}

function readStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`${label} must be a string array`);
  }

  return [...value];
}

function isAccessEventType(value: unknown): value is AccessEvent["eventType"] {
  return (
    value === "attachment.bind" ||
    value === "attachment.detach" ||
    value === "container.create" ||
    value === "container.grant" ||
    value === "container.move" ||
    value === "container.rekey" ||
    value === "container.revoke" ||
    value === "document.link" ||
    value === "document.unlink"
  );
}

function isAccessObjectKind(
  value: unknown,
): value is AccessEvent["objectKind"] {
  return value === "blob" || value === "container" || value === "document";
}

function isRecipientKind(
  value: unknown,
): value is ContainerKekRecipientTarget["recipientKind"] {
  return (
    value === "container" ||
    value === "group" ||
    value === "organization" ||
    value === "user"
  );
}

export function readAccessEvent(value: unknown, label: string): AccessEvent {
  const record = readCanonicalRecord(value, label);
  const eventType = readRecordValue(record, "eventType", label);
  const objectKind = readRecordValue(record, "objectKind", label);
  if (!isAccessEventType(eventType)) {
    throw new Error(`${label}.eventType is invalid`);
  }
  if (!isAccessObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordPositiveInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }

  return {
    version: 1,
    eventId: readRecordString(record, "eventId", label),
    eventType,
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    organizationId: readRecordString(record, "organizationId", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    dependencyManifestHashes: readStringArray(
      readRecordValue(record, "dependencyManifestHashes", label),
      `${label}.dependencyManifestHashes`,
    ),
    bodyHash: readRecordString(record, "bodyHash", label),
    signerUserId: readRecordString(record, "signerUserId", label),
    signerDeviceId: readRecordString(record, "signerDeviceId", label),
    signerKeyFingerprint: readRecordString(
      record,
      "signerKeyFingerprint",
      label,
    ),
    signedAt: readRecordString(record, "signedAt", label),
    signature: readRecordString(record, "signature", label),
  };
}

export function readAccessManifest(
  value: unknown,
  label: string,
): AccessManifest {
  const record = readCanonicalRecord(value, label);
  const objectKind = readRecordValue(record, "objectKind", label);
  if (!isAccessObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordPositiveInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  const referencedPrincipalHeads = readRecordValue(
    record,
    "referencedPrincipalHeads",
    label,
  );
  if (!Array.isArray(referencedPrincipalHeads)) {
    throw new Error(`${label}.referencedPrincipalHeads must be an array`);
  }

  return {
    version: 1,
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordPositiveInteger(record, "epoch", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    eventHash: readRecordString(record, "eventHash", label),
    structuralHash: readRecordString(record, "structuralHash", label),
    grantRoot: readRecordString(record, "grantRoot", label),
    referencedPrincipalHeads: referencedPrincipalHeads.map((head, index) => {
      const headRecord = readCanonicalRecord(
        head,
        `${label}.referencedPrincipalHeads[${index}]`,
      );
      const principalType = readRecordValue(
        headRecord,
        "principalType",
        `${label}.referencedPrincipalHeads[${index}]`,
      );
      if (principalType !== "group" && principalType !== "organization") {
        throw new Error(
          `${label}.referencedPrincipalHeads[${index}].principalType is invalid`,
        );
      }
      return {
        principalType,
        principalId: readRecordString(
          headRecord,
          "principalId",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        version: readRecordPositiveInteger(
          headRecord,
          "version",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        keyEpoch: readRecordPositiveInteger(
          headRecord,
          "keyEpoch",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        stateHash: readRecordString(
          headRecord,
          "stateHash",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        keyFingerprint: readRecordString(
          headRecord,
          "keyFingerprint",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
      };
    }),
    keyTargetHash: readRecordString(record, "keyTargetHash", label),
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

export function readContainerKeyWrap(
  value: unknown,
  label: string,
): ContainerKeyWrap {
  const record = readCanonicalRecord(value, label);
  const recipientKind = readRecordValue(record, "recipientKind", label);
  if (!isRecipientKind(recipientKind)) {
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

export function readContainerKekRecipientTarget(
  value: unknown,
  label: string,
): ContainerKekRecipientTarget {
  const record = readCanonicalRecord(value, label);
  const recipientKind = readRecordValue(record, "recipientKind", label);
  if (!isRecipientKind(recipientKind)) {
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

export function readDocumentAccessEventBody(
  value: unknown,
  label: string,
): DocumentLinkAccessEventBody | DocumentUnlinkAccessEventBody {
  const record = readCanonicalRecord(value, label);
  const eventType = readRecordValue(record, "eventType", label);
  if (eventType !== "document.link" && eventType !== "document.unlink") {
    throw new Error(`${label}.eventType is invalid`);
  }

  return {
    eventType,
    containerId: readRecordString(record, "containerId", label),
    containerManifestHash: readRecordString(
      record,
      "containerManifestHash",
      label,
    ),
  };
}
