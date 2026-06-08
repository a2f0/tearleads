import {
  type AccessEvent,
  type AccessManifest,
  computeAccessEventHash,
  computeAccessManifestHash,
  type DocumentLinkSetManifestState,
  deriveDocumentLinkSetManifest,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../keyingCanonicalJson";

function readRecordValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return record[key];
}

function readRecordString(
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

function readRecordInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label}.${key} must be an integer`);
  }
  return value;
}

function readRecordNumber(
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

function readRecordNullableString(
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

function readAccessEvent(value: unknown, label: string): AccessEvent {
  const record = readCanonicalRecord(value, label);
  const eventType = readRecordValue(record, "eventType");
  const objectKind = readRecordValue(record, "objectKind");
  if (!isAccessEventType(eventType)) {
    throw new Error(`${label}.eventType is invalid`);
  }
  if (!isAccessObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordInteger(record, "version", label) !== 1) {
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
      readRecordValue(record, "dependencyManifestHashes"),
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

function readAccessManifest(value: unknown, label: string): AccessManifest {
  const record = readCanonicalRecord(value, label);
  const objectKind = readRecordValue(record, "objectKind");
  if (!isAccessObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  const referencedPrincipalHeads = readRecordValue(
    record,
    "referencedPrincipalHeads",
  );
  if (!Array.isArray(referencedPrincipalHeads)) {
    throw new Error(`${label}.referencedPrincipalHeads must be an array`);
  }

  return {
    version: 1,
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordNumber(record, "epoch", label),
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
      const principalType = readRecordValue(headRecord, "principalType");
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
        version: readRecordNumber(
          headRecord,
          "version",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        keyEpoch: readRecordNumber(
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

function readDocumentLinkSetManifestState(
  value: unknown,
  label: string,
): DocumentLinkSetManifestState {
  const record = readCanonicalRecord(value, label);
  if (readRecordInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }

  return {
    version: 1,
    documentId: readRecordString(record, "documentId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordNumber(record, "epoch", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    eventHash: readRecordString(record, "eventHash", label),
    linkedContainerIds: readStringArray(
      readRecordValue(record, "linkedContainerIds"),
      `${label}.linkedContainerIds`,
    ),
  };
}

function serializeCanonical(value: unknown, label: string): string {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new Error(`Document create response ${label} is invalid`);
  }

  return serializeKeyingCanonicalJson(
    readCanonicalJson(value, `Document create response ${label}`),
  );
}

export async function assertDocumentManifestBundleConsistent(input: {
  bundle: DocumentCreateResponse["accessManifest"];
  label: string;
}): Promise<{ documentId: string; organizationId: string }> {
  const manifestHash = await computeAccessManifestHash(
    readAccessManifest(input.bundle.manifest, `${input.label} manifest`),
  );
  if (manifestHash !== input.bundle.manifestHash) {
    throw new Error(`${input.label} manifest hash mismatch`);
  }

  const eventBundle = input.bundle.event;
  if (!isPlainRecord(eventBundle)) {
    throw new Error(`${input.label} event bundle is invalid`);
  }
  const eventHash = readRecordString(eventBundle, "eventHash", input.label);
  const event = Reflect.get(eventBundle, "event");
  const accessEvent = readAccessEvent(event, `${input.label} signed event`);
  const computedEventHash = await computeAccessEventHash(accessEvent);
  if (computedEventHash !== eventHash) {
    throw new Error(`${input.label} event hash mismatch`);
  }

  const state = readDocumentLinkSetManifestState(
    input.bundle.state,
    `${input.label} state`,
  );
  if (state.eventHash !== eventHash) {
    throw new Error(`${input.label} state event hash mismatch`);
  }
  const derivedManifest = await deriveDocumentLinkSetManifest(state);
  if (
    serializeCanonical(input.bundle.manifest, "manifest") !==
    serializeCanonical(derivedManifest, "manifest")
  ) {
    throw new Error(`${input.label} manifest state mismatch`);
  }

  return {
    documentId: state.documentId,
    organizationId: state.organizationId,
  };
}
