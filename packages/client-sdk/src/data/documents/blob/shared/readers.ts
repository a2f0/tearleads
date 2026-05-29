import {
  assertAesGcmIv,
  CONTENT_RECORD_ENCRYPTION_SUITE,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { BlobContentKeyTargetEnvelopeRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  assertOnlyRecordKeys,
  readRecordNumber,
  readRecordString,
} from "../../shared/readers";
import type {
  BlobContentKeyTarget,
  BlobEncryptedBytesRecord,
  DocumentManifestIdentity,
} from "./types";
import {
  BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_KEYS,
} from "./types";

function targetKey(target: BlobContentKeyTarget): string {
  return [
    target.bindingId,
    target.documentId,
    target.containerId,
    target.containerManifestHash,
    target.containerKeyEpochId,
    String(target.containerKeyEpoch),
  ].join(":");
}

export function sortBlobTargets<T extends BlobContentKeyTarget>(
  targets: readonly T[],
): T[] {
  return [...targets].sort((left, right) =>
    targetKey(left).localeCompare(targetKey(right)),
  );
}

export function readDocumentManifestIdentity(
  writerProjection: DocumentWriterProjectionResponse,
): DocumentManifestIdentity {
  const { documentManifest } = writerProjection;
  if (!isPlainRecord(documentManifest.state)) {
    throw new Error("Document writer projection manifest state is invalid");
  }

  const documentId = readRecordString(
    documentManifest.state,
    "documentId",
    "Document writer projection manifest state",
  );
  if (documentId !== writerProjection.documentId) {
    throw new Error("Document writer projection document id is inconsistent");
  }

  return {
    documentId,
    manifestHash: documentManifest.manifestHash,
    organizationId: readRecordString(
      documentManifest.state,
      "organizationId",
      "Document writer projection manifest state",
    ),
  };
}

export function normalizeDocumentTarget(
  value: Record<string, unknown>,
): Omit<BlobContentKeyTarget, "bindingId" | "documentId"> {
  return {
    containerId: readRecordString(value, "containerId", "Document KEK target"),
    containerManifestHash: readRecordString(
      value,
      "containerManifestHash",
      "Document KEK target",
    ),
    containerKeyEpochId: readRecordString(
      value,
      "containerKeyEpochId",
      "Document KEK target",
    ),
    containerKeyEpoch: readRecordNumber(
      value,
      "containerKeyEpoch",
      "Document KEK target",
    ),
  };
}

export function parseBlobEncryptedBytes(
  encryptedBytes: string,
): BlobEncryptedBytesRecord {
  let value: unknown;
  try {
    value = JSON.parse(encryptedBytes);
  } catch {
    throw new Error("Blob encrypted bytes are invalid JSON");
  }
  if (!isPlainRecord(value)) {
    throw new Error("Blob encrypted bytes must be an object");
  }
  assertOnlyRecordKeys(
    value,
    BLOB_ENCRYPTED_BYTES_KEYS,
    "Blob encrypted bytes",
  );
  if (
    readRecordString(value, "format", "Blob encrypted bytes") !==
    BLOB_ENCRYPTED_BYTES_FORMAT
  ) {
    throw new Error("Blob encrypted bytes format is invalid");
  }
  const version = readRecordNumber(value, "version", "Blob encrypted bytes");
  if (version !== 1) {
    throw new Error(
      `Blob encrypted bytes version ${version} is invalid; expected 1`,
    );
  }
  if (
    readRecordString(value, "encryptionSuite", "Blob encrypted bytes") !==
    CONTENT_RECORD_ENCRYPTION_SUITE
  ) {
    throw new Error("Blob encrypted bytes suite is invalid");
  }

  const iv = base64ToBytes(
    readRecordString(value, "iv", "Blob encrypted bytes"),
  );
  assertAesGcmIv(iv, "Blob encrypted bytes IV is invalid");

  return {
    blobId: readRecordString(value, "blobId", "Blob encrypted bytes"),
    byteLength: readRecordNumber(value, "byteLength", "Blob encrypted bytes"),
    ciphertext: base64ToBytes(
      readRecordString(value, "ciphertext", "Blob encrypted bytes"),
    ),
    contentKeyEpoch: readRecordNumber(
      value,
      "contentKeyEpoch",
      "Blob encrypted bytes",
    ),
    contentRecordId: readRecordString(
      value,
      "contentRecordId",
      "Blob encrypted bytes",
    ),
    iv,
    metadataHash: readRecordString(
      value,
      "metadataHash",
      "Blob encrypted bytes",
    ),
    nonceDomainHash: readRecordString(
      value,
      "nonceDomainHash",
      "Blob encrypted bytes",
    ),
  };
}

export function contentKeyTargetReference(
  envelope: BlobContentKeyTargetEnvelopeRequest,
): BlobContentKeyTarget {
  return {
    bindingId: envelope.bindingId,
    documentId: envelope.documentId,
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

export function readBlobKekTarget(
  value: Record<string, unknown>,
  label: string,
): BlobContentKeyTarget {
  return {
    bindingId: readRecordString(value, "bindingId", label),
    documentId: readRecordString(value, "documentId", label),
    containerId: readRecordString(value, "containerId", label),
    containerManifestHash: readRecordString(
      value,
      "containerManifestHash",
      label,
    ),
    containerKeyEpochId: readRecordString(value, "containerKeyEpochId", label),
    containerKeyEpoch: readRecordNumber(value, "containerKeyEpoch", label),
  };
}
