import type {
  AccessEventV2,
  AccessManifestV2,
  KeyingV2CanonicalJson,
  ManagedPrincipalKindV2,
  ReferencedPrincipalHeadV2,
  VerifiedAccessEvent,
} from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";

type ProjectionErrorFactory = (message: string) => Error;

export function readProjectionPlainRecord(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw error(`${label} is invalid`);
  }
  return value;
}

export function readProjectionRecord(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): Record<string, unknown> {
  return { ...readProjectionPlainRecord(value, label, error) };
}

export function readProjectionValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return Reflect.get(record, key);
}

export function readProjectionString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  error: ProjectionErrorFactory,
): string {
  const value = readProjectionValue(record, key);
  if (typeof value !== "string" || value.length === 0) {
    throw error(`${label}.${key} is invalid`);
  }
  return value;
}

export function readProjectionNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  error: ProjectionErrorFactory,
): string | null {
  if (!Reflect.has(record, key)) {
    throw error(`${label}.${key} is invalid`);
  }
  const value = readProjectionValue(record, key);
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw error(`${label}.${key} is invalid`);
  }
  return value;
}

export function readProjectionPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
  error: ProjectionErrorFactory,
): number {
  const value = readProjectionValue(record, key);
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw error(`${label}.${key} is invalid`);
  }
  return value;
}

export function readProjectionStringArray(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw error(`${label} is invalid`);
  }
  return [...value];
}

export function readProjectionVersion2(
  record: Record<string, unknown>,
  label: string,
  error: ProjectionErrorFactory,
): void {
  if (readProjectionPositiveInteger(record, "version", label, error) !== 2) {
    throw error(`${label}.version is invalid`);
  }
}

function isAccessEventType(
  value: unknown,
): value is AccessEventV2["eventType"] {
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
): value is AccessEventV2["objectKind"] {
  return value === "blob" || value === "container" || value === "document";
}

function isManagedPrincipalKind(
  value: unknown,
): value is ManagedPrincipalKindV2 {
  return value === "group" || value === "organization";
}

export function readProjectionAccessEvent(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): AccessEventV2 {
  const record = readProjectionPlainRecord(value, label, error);
  const eventType = readProjectionValue(record, "eventType");
  const objectKind = readProjectionValue(record, "objectKind");
  if (!isAccessEventType(eventType)) {
    throw error(`${label}.eventType is invalid`);
  }
  if (!isAccessObjectKind(objectKind)) {
    throw error(`${label}.objectKind is invalid`);
  }
  readProjectionVersion2(record, label, error);

  return {
    version: 2,
    eventId: readProjectionString(record, "eventId", label, error),
    eventType,
    objectKind,
    objectId: readProjectionString(record, "objectId", label, error),
    organizationId: readProjectionString(
      record,
      "organizationId",
      label,
      error,
    ),
    previousManifestHash: readProjectionNullableString(
      record,
      "previousManifestHash",
      label,
      error,
    ),
    dependencyManifestHashes: readProjectionStringArray(
      readProjectionValue(record, "dependencyManifestHashes"),
      `${label}.dependencyManifestHashes`,
      error,
    ),
    bodyHash: readProjectionString(record, "bodyHash", label, error),
    signerUserId: readProjectionString(record, "signerUserId", label, error),
    signerDeviceId: readProjectionString(
      record,
      "signerDeviceId",
      label,
      error,
    ),
    signerKeyFingerprint: readProjectionString(
      record,
      "signerKeyFingerprint",
      label,
      error,
    ),
    signedAt: readProjectionString(record, "signedAt", label, error),
    signature: readProjectionString(record, "signature", label, error),
  };
}

function accessEventRecord(event: AccessEventV2): Record<string, unknown> {
  return {
    version: event.version,
    eventId: event.eventId,
    eventType: event.eventType,
    objectKind: event.objectKind,
    objectId: event.objectId,
    organizationId: event.organizationId,
    previousManifestHash: event.previousManifestHash,
    dependencyManifestHashes: [...event.dependencyManifestHashes],
    bodyHash: event.bodyHash,
    signerUserId: event.signerUserId,
    signerDeviceId: event.signerDeviceId,
    signerKeyFingerprint: event.signerKeyFingerprint,
    signedAt: event.signedAt,
    signature: event.signature,
  };
}

export function projectionVerifiedAccessEventRecord(
  event: VerifiedAccessEvent,
): Record<string, unknown> {
  return {
    event: accessEventRecord(event.event),
    body: event.body,
    eventHash: event.eventHash,
  };
}

export function readProjectionVerifiedAccessEvent(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): VerifiedAccessEvent {
  const record = readProjectionPlainRecord(value, label, error);
  const event = readProjectionAccessEvent(
    readProjectionValue(record, "event"),
    `${label}.event`,
    error,
  );
  const body = readProjectionValue(record, "body");
  if (body === undefined) {
    throw error(`${label}.body is invalid`);
  }

  return {
    event,
    body: body as KeyingV2CanonicalJson,
    eventHash: readProjectionString(record, "eventHash", label, error),
  } as VerifiedAccessEvent;
}

function projectionReferencedPrincipalHeadRecord(
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

function readProjectionReferencedPrincipalHead(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): ReferencedPrincipalHeadV2 {
  const record = readProjectionPlainRecord(value, label, error);
  const principalType = readProjectionValue(record, "principalType");
  if (!isManagedPrincipalKind(principalType)) {
    throw error(`${label}.principalType is invalid`);
  }

  return {
    principalType,
    principalId: readProjectionString(record, "principalId", label, error),
    version: readProjectionPositiveInteger(record, "version", label, error),
    keyEpoch: readProjectionPositiveInteger(record, "keyEpoch", label, error),
    stateHash: readProjectionString(record, "stateHash", label, error),
    keyFingerprint: readProjectionString(
      record,
      "keyFingerprint",
      label,
      error,
    ),
  };
}

export function readProjectionReferencedPrincipalHeads(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): ReferencedPrincipalHeadV2[] {
  if (!Array.isArray(value)) {
    throw error(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readProjectionReferencedPrincipalHead(entry, `${label}[${index}]`, error),
  );
}

export function projectionAccessManifestRecord(
  manifest: AccessManifestV2,
): Record<string, unknown> {
  return {
    version: manifest.version,
    objectKind: manifest.objectKind,
    objectId: manifest.objectId,
    organizationId: manifest.organizationId,
    epoch: manifest.epoch,
    previousManifestHash: manifest.previousManifestHash,
    eventHash: manifest.eventHash,
    structuralHash: manifest.structuralHash,
    grantRoot: manifest.grantRoot,
    referencedPrincipalHeads: manifest.referencedPrincipalHeads.map(
      projectionReferencedPrincipalHeadRecord,
    ),
    keyTargetHash: manifest.keyTargetHash,
  };
}

export function readProjectionAccessManifest(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): AccessManifestV2 {
  const record = readProjectionPlainRecord(value, label, error);
  const objectKind = readProjectionValue(record, "objectKind");
  if (!isAccessObjectKind(objectKind)) {
    throw error(`${label}.objectKind is invalid`);
  }
  readProjectionVersion2(record, label, error);

  return {
    version: 2,
    objectKind,
    objectId: readProjectionString(record, "objectId", label, error),
    organizationId: readProjectionString(
      record,
      "organizationId",
      label,
      error,
    ),
    epoch: readProjectionPositiveInteger(record, "epoch", label, error),
    previousManifestHash: readProjectionNullableString(
      record,
      "previousManifestHash",
      label,
      error,
    ),
    eventHash: readProjectionString(record, "eventHash", label, error),
    structuralHash: readProjectionString(
      record,
      "structuralHash",
      label,
      error,
    ),
    grantRoot: readProjectionString(record, "grantRoot", label, error),
    referencedPrincipalHeads: readProjectionReferencedPrincipalHeads(
      readProjectionValue(record, "referencedPrincipalHeads"),
      `${label}.referencedPrincipalHeads`,
      error,
    ),
    keyTargetHash: readProjectionString(record, "keyTargetHash", label, error),
  };
}
