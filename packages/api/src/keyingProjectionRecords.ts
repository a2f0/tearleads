import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifest,
  ContainerGrantPrincipalHead,
  KeyingCanonicalJson,
  KeyingVerificationError,
  ManagedPrincipalKind,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
} from "@symcrypt/crypto";
import { makeVerifiedAccessEvent } from "@symcrypt/crypto";
import { isPlainObject } from "@symcrypt/validators/isPlainObject";
import type { AccessEventBundleWireResponse } from "@symcrypt/validators/util";
import { projectionReferencedPrincipalHeadRecord } from "./keyingProjectionManifestRecords";
import { isKeyingCanonicalJson } from "./utils/canonicalJson";

export {
  accessManifestCheckpoint,
  containerAccessManifestStateRecord,
  documentLinkSetStateRecord,
  projectionReferencedPrincipalHeadRecord,
} from "./keyingProjectionManifestRecords";

type ProjectionErrorFactory = (message: string) => Error;

/**
 * Maps a KeyingVerificationError to the HTTP status shared by the container,
 * document, and blob mutation boundaries: bad signatures and authorization
 * failures are 403, malformed shapes 400, and everything else (stale state,
 * epoch races) a retriable 409.
 */
export function keyingVerificationHttpStatus(
  error: KeyingVerificationError,
): 400 | 403 | 409 {
  if (
    error.code === "signature_mismatch" ||
    error.code === "signer_mismatch" ||
    error.code === "unauthorized"
  ) {
    return 403;
  }

  if (
    error.code === "invalid_domain" ||
    error.code === "invalid_shape" ||
    error.code === "object_mismatch"
  ) {
    return 400;
  }

  return 409;
}

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

export function readProjectionCanonicalJson(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): KeyingCanonicalJson {
  if (!isKeyingCanonicalJson(value)) {
    throw error(`${label} is invalid`);
  }

  return value;
}

export function readProjectionVersion(
  record: Record<string, unknown>,
  label: string,
  error: ProjectionErrorFactory,
): void {
  if (readProjectionPositiveInteger(record, "version", label, error) !== 1) {
    throw error(`${label}.version is invalid`);
  }
}

export function isAccessEventType(
  value: unknown,
): value is AccessEvent["eventType"] {
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

function isManagedPrincipalKind(value: unknown): value is ManagedPrincipalKind {
  return value === "group" || value === "organization";
}

export function readProjectionAccessEvent(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): AccessEvent {
  const record = readProjectionPlainRecord(value, label, error);
  const eventType = readProjectionValue(record, "eventType");
  const objectKind = readProjectionValue(record, "objectKind");
  if (!isAccessEventType(eventType)) {
    throw error(`${label}.eventType is invalid`);
  }
  if (!isAccessObjectKind(objectKind)) {
    throw error(`${label}.objectKind is invalid`);
  }
  readProjectionVersion(record, label, error);

  return {
    version: 1,
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

function accessEventRecord(event: AccessEvent): Record<string, unknown> {
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
): AccessEventBundleWireResponse {
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
  const body = readProjectionCanonicalJson(
    readProjectionValue(record, "body"),
    `${label}.body`,
    error,
  );

  return makeVerifiedAccessEvent({
    event,
    body,
    eventHash: readProjectionString(record, "eventHash", label, error),
  });
}

function readProjectionReferencedPrincipalHead(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): ReferencedPrincipalHead {
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

function readProjectionReferencedPrincipalHeads(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): ReferencedPrincipalHead[] {
  if (!Array.isArray(value)) {
    throw error(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readProjectionReferencedPrincipalHead(entry, `${label}[${index}]`, error),
  );
}

function isContainerGrantPrincipalHead(
  principalHead: ReferencedPrincipalHead,
): principalHead is ContainerGrantPrincipalHead {
  return principalHead.principalType === "group";
}

export function readProjectionContainerGrantPrincipalHeads(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): ContainerGrantPrincipalHead[] {
  const principalHeads = readProjectionReferencedPrincipalHeads(
    value,
    label,
    error,
  );
  if (!principalHeads.every(isContainerGrantPrincipalHead)) {
    throw error(`${label} may reference only group principals`);
  }

  return principalHeads;
}

export function projectionAccessManifestRecord(
  manifest: AccessManifest,
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
): AccessManifest {
  const record = readProjectionPlainRecord(value, label, error);
  const objectKind = readProjectionValue(record, "objectKind");
  if (!isAccessObjectKind(objectKind)) {
    throw error(`${label}.objectKind is invalid`);
  }
  readProjectionVersion(record, label, error);

  return {
    version: 1,
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

export function readProjectionContainerAccessManifest(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): ContainerAccessManifest {
  const manifest = readProjectionAccessManifest(value, label, error);
  if (manifest.objectKind !== "container") {
    throw error(`${label}.objectKind must be container`);
  }

  return {
    ...manifest,
    objectKind: "container",
    referencedPrincipalHeads: readProjectionContainerGrantPrincipalHeads(
      manifest.referencedPrincipalHeads,
      `${label}.referencedPrincipalHeads`,
      error,
    ),
  };
}

export function createProjectionReaders(error: ProjectionErrorFactory) {
  return {
    accessManifestRecord: projectionAccessManifestRecord,
    readAccessManifest(value: unknown, label: string) {
      return readProjectionAccessManifest(value, label, error);
    },
    readContainerAccessManifest(value: unknown, label: string) {
      return readProjectionContainerAccessManifest(value, label, error);
    },
    readCanonicalRecord(value: KeyingCanonicalJson, label: string) {
      return readProjectionRecord(value, label, error);
    },
    readNullableString(
      record: Record<string, unknown>,
      key: string,
      label: string,
    ) {
      return readProjectionNullableString(record, key, label, error);
    },
    readPlainRecord(value: unknown, label: string) {
      return readProjectionPlainRecord(value, label, error);
    },
    readPositiveInteger(
      record: Record<string, unknown>,
      key: string,
      label: string,
    ) {
      return readProjectionPositiveInteger(record, key, label, error);
    },
    readReferencedPrincipalHeads(value: unknown, label: string) {
      return readProjectionReferencedPrincipalHeads(value, label, error);
    },
    readString(record: Record<string, unknown>, key: string, label: string) {
      return readProjectionString(record, key, label, error);
    },
    readStringArray(value: unknown, label: string) {
      return readProjectionStringArray(value, label, error);
    },
    readValue: readProjectionValue,
    readVerifiedAccessEvent(value: unknown, label: string) {
      return readProjectionVerifiedAccessEvent(value, label, error);
    },
    readVersion(record: Record<string, unknown>, label: string) {
      return readProjectionVersion(record, label, error);
    },
    verifiedAccessEventRecord: projectionVerifiedAccessEventRecord,
  };
}
