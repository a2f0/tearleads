import { isPlainObject as isPlainRecord } from "@symcrypt/validators/isPlainObject";
import type { BlobContentKeyTargetEnvelopeRequest } from "@symcrypt/validators/request";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  readRecordPositiveInteger,
  readRecordString,
  sortTargets,
} from "../../shared/readers";
import { parseBlobEnvelopeV2 } from "./blobEnvelopeReader";
import type {
  BlobContentKeyTarget,
  BlobEncryptedBytesRecord,
  DocumentManifestIdentity,
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
  return sortTargets(targets, targetKey);
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
    containerKeyEpoch: readRecordPositiveInteger(
      value,
      "containerKeyEpoch",
      "Document KEK target",
    ),
  };
}

export function parseBlobEncryptedBytes(
  encryptedBytes: Uint8Array<ArrayBuffer>,
): BlobEncryptedBytesRecord {
  return parseBlobEnvelopeV2(encryptedBytes);
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
    containerKeyEpoch: readRecordPositiveInteger(
      value,
      "containerKeyEpoch",
      label,
    ),
  };
}
