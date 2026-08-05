export {
  readRecordNullableString,
  readRecordPositiveInteger,
  readRecordString,
} from "../../recordReaders";

import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type ContainerKeyWrap,
  type DocumentContentKeyTarget,
  type WriteHeader,
} from "@tearleads/crypto";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import { readCanonicalRecord } from "../../keyingCanonicalJson";
import {
  readRecordInteger,
  readRecordPositiveInteger,
  readRecordString,
  readRecordValue,
} from "../../recordReaders";

export {
  assertDocumentManifestBundleConsistent,
  serializeCanonical,
} from "./manifestBundleReaders";

function isContentObjectKind(
  value: unknown,
): value is WriteHeader["objectKind"] {
  return value === "blob" || value === "document";
}

export function readWriteHeader(value: unknown, label: string): WriteHeader {
  const record = readCanonicalRecord(value, label);
  const objectKind = readRecordValue(record, "objectKind");
  if (!isContentObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  const encryptionSuite = readRecordValue(record, "encryptionSuite");
  if (encryptionSuite !== CONTENT_RECORD_ENCRYPTION_SUITE) {
    throw new Error(`${label}.encryptionSuite is invalid`);
  }

  return {
    version: 1,
    organizationId: readRecordString(record, "organizationId", label),
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    accessManifestHash: readRecordString(record, "accessManifestHash", label),
    contentKeyEpoch: readRecordPositiveInteger(
      record,
      "contentKeyEpoch",
      label,
    ),
    targetHash: readRecordString(record, "targetHash", label),
    encryptionSuite,
    contentRecordId: readRecordString(record, "contentRecordId", label),
    nonceDomainHash: readRecordString(record, "nonceDomainHash", label),
    metadataHash: readRecordString(record, "metadataHash", label),
    ciphertextHash: readRecordString(record, "ciphertextHash", label),
    writerUserId: readRecordString(record, "writerUserId", label),
    writerDeviceId: readRecordString(record, "writerDeviceId", label),
    writerKeyFingerprint: readRecordString(
      record,
      "writerKeyFingerprint",
      label,
    ),
    signedAt: readRecordString(record, "signedAt", label),
    signature: readRecordString(record, "signature", label),
  };
}

export function readManifestContainerId(
  bundle: ContainerWriterProjectionResponse["path"][number],
): string | null {
  const containerId = isPlainRecord(bundle.state)
    ? Reflect.get(bundle.state, "containerId")
    : undefined;

  return isPlainRecord(bundle.state) && typeof containerId === "string"
    ? containerId
    : null;
}

export function targetKey(target: DocumentContentKeyTarget): string {
  return [
    target.containerId,
    target.containerManifestHash,
    target.containerKeyEpochId,
    String(target.containerKeyEpoch),
  ].join(":");
}

export function sortTargets<T>(
  targets: readonly T[],
  keyOf: (target: T) => string,
): T[] {
  return [...targets].sort((left, right) =>
    keyOf(left).localeCompare(keyOf(right)),
  );
}

export function sortDocumentTargets<T extends DocumentContentKeyTarget>(
  targets: readonly T[],
): T[] {
  return sortTargets(targets, targetKey);
}

export function describeDocumentTargetKek(
  target: DocumentContentKeyTarget,
): string {
  return `container ${target.containerId} epoch ${target.containerKeyEpochId}`;
}

export function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function asWebCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = bytes.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("Document byte material must be ArrayBuffer-backed");
  }
  return new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength);
}

export function assertOnlyRecordKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  const unexpectedKeys = Object.keys(record).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `${label} has unexpected keys: ${unexpectedKeys.join(",")}`,
    );
  }
}

export function normalizeContainerKeyWrap(value: unknown): ContainerKeyWrap {
  if (!isPlainRecord(value)) {
    throw new Error("Container writer projection KEK wrap is invalid");
  }

  const recipientKind = readRecordString(
    value,
    "recipientKind",
    "container KEK wrap",
  );
  if (
    recipientKind !== "user" &&
    recipientKind !== "group" &&
    recipientKind !== "organization" &&
    recipientKind !== "container"
  ) {
    throw new Error(
      "Container writer projection KEK wrap recipient is invalid",
    );
  }

  return {
    containerKeyEpochId: readRecordString(
      value,
      "containerKeyEpochId",
      "container KEK wrap",
    ),
    recipientKind,
    recipientId: readRecordString(value, "recipientId", "container KEK wrap"),
    recipientKeyEpochId: readRecordString(
      value,
      "recipientKeyEpochId",
      "container KEK wrap",
    ),
    recipientKeyFingerprint: readRecordString(
      value,
      "recipientKeyFingerprint",
      "container KEK wrap",
    ),
    kemCipherText: readRecordString(
      value,
      "kemCipherText",
      "container KEK wrap",
    ),
    wrappedKey: readRecordString(value, "wrappedKey", "container KEK wrap"),
    wrapManifestHash: readRecordString(
      value,
      "wrapManifestHash",
      "container KEK wrap",
    ),
  };
}

export function assertEqualBytes(
  left: Uint8Array,
  right: Uint8Array,
  message: string,
): void {
  let mismatch = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  if (mismatch !== 0) {
    throw new Error(message);
  }
}

function readDocumentTarget(
  value: Record<string, unknown>,
  label: string,
): DocumentContentKeyTarget {
  return {
    containerId: readRecordString(value, "containerId", label),
    containerManifestHash: readRecordString(
      value,
      "containerManifestHash",
      label,
    ),
    containerKeyEpochId: readRecordString(value, "containerKeyEpochId", label),
    containerKeyEpoch: readRecordPositiveInteger(
      value,
      "containerKeyEpoch",
      label,
    ),
  };
}

export function normalizeDocumentKekTargetResponse(
  targets: DocumentSyncResponse["documentKekTargets"],
): DocumentContentKeyTarget[] {
  return sortDocumentTargets(
    targets.targets.map((target, index) => {
      if (!isPlainRecord(target)) {
        throw new Error(`Document KEK target[${index}] is invalid`);
      }
      return readDocumentTarget(target, `Document KEK target[${index}]`);
    }),
  );
}

export function targetEnvelopeReference(
  envelope: DocumentCreateResponse["contentKeyBundle"]["targets"][number],
): DocumentContentKeyTarget {
  return {
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

export function serializeState(value: unknown): string {
  return JSON.stringify(value);
}
