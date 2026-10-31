import type {
  ContentObjectKind,
  ContentRecordEncryptionSuite,
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
  WriteHeader,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  makeVerifiedDocumentKekTargets,
} from "@tearleads/crypto";
import type {
  DocumentContentKeyBundleRequest,
  DocumentContentKeyTargetEnvelope,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  AccessManifestBundleWireResponse,
  DocumentContentKeyBundleResponse,
  DocumentKekTargetsResponse,
  DocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import type {
  StoredDocumentContentKeyBundle,
  DocumentContentKeyTargetEnvelope as StoredDocumentContentKeyTargetEnvelope,
} from "../../../../access/read/documentContentKeyStore";
import type { resolveCurrentDocumentKekTargets } from "../../../../access/read/documentKekTargets";
import {
  documentLinkSetStateRecord,
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
  readProjectionCanonicalJson,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionRecord,
  readProjectionString,
  readProjectionStringArray,
  readProjectionValue,
  readProjectionVersion,
} from "../../../../keyingProjectionRecords";
import { DocumentMutationError, documentShapeError } from "../errors";

function isContentObjectKind(value: unknown): value is ContentObjectKind {
  return value === "blob" || value === "document";
}

function isContentRecordEncryptionSuite(
  value: unknown,
): value is ContentRecordEncryptionSuite {
  return value === CONTENT_RECORD_ENCRYPTION_SUITE;
}

export function documentManifestBundleRecord(
  manifest: VerifiedDocumentLinkSetManifest,
): AccessManifestBundleWireResponse {
  return {
    event: projectionVerifiedAccessEventRecord(manifest.event),
    manifest: projectionAccessManifestRecord(manifest.manifest),
    manifestHash: manifest.manifestHash,
    state: documentLinkSetStateRecord(manifest.state),
  };
}

/**
 * The hash acknowledgement of a committed document create or link-set
 * mutation: the signed event and manifest hashes, the stored content-key
 * epoch, and the KEK target hash this transaction resolved.
 */
export function documentMutationAcknowledgement(
  manifest: VerifiedDocumentLinkSetManifest,
  contentKeyBundle: {
    readonly contentKeyEpoch: number;
    readonly currentTargets: { readonly documentKeyTargetHash: string };
  },
): Omit<DocumentLinkSetMutationResponse, "id"> {
  return {
    contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
    eventHash: manifest.event.eventHash,
    manifestHash: manifest.manifestHash,
    targetHash: contentKeyBundle.currentTargets.documentKeyTargetHash,
  };
}

export function verifiedDocumentKekTargetsFromResolved(
  targets: Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>,
): VerifiedDocumentKekTargets {
  return makeVerifiedDocumentKekTargets({
    documentId: targets.documentId,
    linkSetManifestHash: targets.linkSetManifestHash,
    linkedContainerManifestHashes: [...targets.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...targets.linkedContainerKeyEpochIds],
    targets: targets.targets.map((target) => ({ ...target })),
    documentKeyTargetHash: targets.documentKeyTargetHash,
  });
}

function readWriteHeaderString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  return readProjectionString(record, key, label, documentShapeError);
}

export function readWriteHeader(value: unknown, label: string): WriteHeader {
  const record = readProjectionPlainRecord(value, label, documentShapeError);
  const objectKind = readProjectionValue(record, "objectKind");
  const encryptionSuite = readProjectionValue(record, "encryptionSuite");
  if (!isContentObjectKind(objectKind)) {
    throw documentShapeError(`${label}.objectKind is invalid`);
  }
  if (!isContentRecordEncryptionSuite(encryptionSuite)) {
    throw documentShapeError(`${label}.encryptionSuite is invalid`);
  }
  readProjectionVersion(record, label, documentShapeError);

  return {
    version: 1,
    dependencyManifestHashes: readProjectionStringArray(
      readProjectionValue(record, "dependencyManifestHashes"),
      `${label}.dependencyManifestHashes`,
      documentShapeError,
    ),
    organizationId: readWriteHeaderString(record, "organizationId", label),
    objectKind,
    objectId: readWriteHeaderString(record, "objectId", label),
    accessManifestHash: readWriteHeaderString(
      record,
      "accessManifestHash",
      label,
    ),
    contentKeyEpoch: readProjectionPositiveInteger(
      record,
      "contentKeyEpoch",
      label,
      documentShapeError,
    ),
    targetHash: readWriteHeaderString(record, "targetHash", label),
    encryptionSuite,
    contentRecordId: readWriteHeaderString(record, "contentRecordId", label),
    nonceDomainHash: readWriteHeaderString(record, "nonceDomainHash", label),
    metadataHash: readWriteHeaderString(record, "metadataHash", label),
    ciphertextHash: readWriteHeaderString(record, "ciphertextHash", label),
    writerUserId: readWriteHeaderString(record, "writerUserId", label),
    writerDeviceId: readWriteHeaderString(record, "writerDeviceId", label),
    writerKeyFingerprint: readWriteHeaderString(
      record,
      "writerKeyFingerprint",
      label,
    ),
    signedAt: readWriteHeaderString(record, "signedAt", label),
    signature: readWriteHeaderString(record, "signature", label),
  };
}

export function writeHeaderRecord(
  header: WriteHeader,
): Record<string, unknown> {
  return {
    version: header.version,
    organizationId: header.organizationId,
    objectKind: header.objectKind,
    objectId: header.objectId,
    accessManifestHash: header.accessManifestHash,
    dependencyManifestHashes: [...header.dependencyManifestHashes],
    contentKeyEpoch: header.contentKeyEpoch,
    targetHash: header.targetHash,
    encryptionSuite: header.encryptionSuite,
    contentRecordId: header.contentRecordId,
    nonceDomainHash: header.nonceDomainHash,
    metadataHash: header.metadataHash,
    ciphertextHash: header.ciphertextHash,
    writerUserId: header.writerUserId,
    writerDeviceId: header.writerDeviceId,
    writerKeyFingerprint: header.writerKeyFingerprint,
    signedAt: header.signedAt,
    signature: header.signature,
  };
}

function toStoredTargetEnvelope(
  target: DocumentContentKeyTargetEnvelope,
): StoredDocumentContentKeyTargetEnvelope {
  return {
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
    wrappedKey: target.wrappedKey,
    wrappingMetadata: readProjectionCanonicalJson(
      target.wrappingMetadata,
      "Document content-key target wrapping metadata",
      documentShapeError,
    ),
  };
}

export function toStoredContentKeyBundleInput(
  documentId: string,
  bundle: DocumentContentKeyBundleRequest,
) {
  return {
    documentId,
    contentKeyEpoch: bundle.contentKeyEpoch,
    linkSetManifestHash: bundle.linkSetManifestHash,
    targetHash: bundle.targetHash,
    targets: bundle.targets.map(toStoredTargetEnvelope),
  };
}

export function assertSyncContentKeyBundleMatchesRequest(
  request: DocumentSyncRequest,
): void {
  if (
    request.containerRekeys &&
    request.containerRekeys.length > 0 &&
    request.outgoingUpdates.length === 0
  ) {
    throw new DocumentMutationError(
      "Container rekeys require outgoing document writes",
      400,
    );
  }

  if (request.contentKeyBundle && request.outgoingUpdates.length === 0) {
    throw new DocumentMutationError(
      "Content key bundles require outgoing document writes",
      400,
    );
  }

  if (!request.contentKeyBundle) {
    return;
  }

  if (
    request.contentKeyBundle.contentKeyEpoch !== request.contentKeyEpoch ||
    request.contentKeyBundle.linkSetManifestHash !==
      request.expectedLinkSetManifestHash ||
    request.contentKeyBundle.targetHash !== request.expectedTargetHash
  ) {
    throw new DocumentMutationError(
      "Content key bundle does not match sync request",
      400,
    );
  }
}

export function toContentKeyBundleResponse(
  bundle: StoredDocumentContentKeyBundle,
  recordErrorFactory: (message: string) => Error = documentShapeError,
): DocumentContentKeyBundleResponse {
  return {
    documentId: bundle.documentId,
    contentKeyEpoch: bundle.contentKeyEpoch,
    linkSetManifestHash: bundle.linkSetManifestHash,
    targetHash: bundle.targetHash,
    targets: bundle.targets.map((target) => ({
      containerId: target.containerId,
      containerManifestHash: target.containerManifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      containerKeyEpoch: target.containerKeyEpoch,
      wrappedKey: target.wrappedKey,
      wrappingMetadata: readProjectionRecord(
        target.wrappingMetadata,
        "Document content-key target wrapping metadata",
        recordErrorFactory,
      ),
    })),
  };
}

export function toDocumentKekTargetsResponse(
  targets: Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>,
): DocumentKekTargetsResponse {
  return {
    documentId: targets.documentId,
    linkSetManifestHash: targets.linkSetManifestHash,
    linkedContainerManifestHashes: [...targets.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...targets.linkedContainerKeyEpochIds],
    targets: targets.targets.map((target) => ({ ...target })),
    documentKeyTargetHash: targets.documentKeyTargetHash,
  };
}
