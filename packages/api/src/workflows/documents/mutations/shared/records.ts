import type {
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
  WriteHeader,
} from "@tearleads/crypto";
import { makeVerifiedDocumentKekTargets } from "@tearleads/crypto";
import type {
  DocumentContentKeyBundleRequest,
  DocumentContentKeyTargetEnvelope,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentContentKeyBundleResponse,
  DocumentKekTargetsResponse,
  DocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import type {
  StoredDocumentContentKeyBundle,
  DocumentContentKeyTargetEnvelope as StoredDocumentContentKeyTargetEnvelope,
} from "../../../../access/read/documentContentKeyStore";
import type { resolveCurrentDocumentKekTargets } from "../../../../access/read/documentKekTargets";
import { readProjectionWriteHeader } from "../../../../keyingProjectionRecords";
import {
  copyProjectionRecord,
  parseProjection,
  projectionCanonicalJson,
} from "../../../../keyingProjectionSchemas";
import { DocumentMutationError, documentShapeError } from "../errors";

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

export function readWriteHeader(value: unknown, label: string): WriteHeader {
  return readProjectionWriteHeader(value, label, documentShapeError);
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
    wrappingMetadata: parseProjection(
      projectionCanonicalJson,
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
      wrappingMetadata: copyProjectionRecord(
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
