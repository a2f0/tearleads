import type { BlobWriteAuthorization } from "@tearleads/api-shared/schema";
import type {
  AccessEvent,
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  ContentObjectKind,
  ContentRecordEncryptionSuite,
  KeyingCanonicalJson,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  WriteHeader,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  makeVerifiedBlobKekTargets,
} from "@tearleads/crypto";
import type {
  BlobContentKeyBundleRequest,
  BlobContentKeyTargetEnvelopeRequest,
} from "@tearleads/validators/request";
import type {
  BlobContentKeyBundleResponse,
  BlobKekTargetsResponse,
} from "@tearleads/validators/response";
import type {
  BlobContentKeyTargetEnvelope,
  StoredBlobContentKeyBundleWithTargets,
} from "../../../access/read/blobContentKeyStore";
import type { resolveCurrentBlobKekTargets } from "../../../access/read/blobKekTargets";
import {
  projectionVerifiedAccessEventRecord,
  readProjectionAccessEvent,
  readProjectionCanonicalJson,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionRecord,
  readProjectionString,
  readProjectionValue,
  readProjectionVersion,
} from "../../../keyingProjectionRecords";
import { BlobMutationError } from "./types";

export type ResolvedBlobKekTargets = Awaited<
  ReturnType<typeof resolveCurrentBlobKekTargets>
>;

function blobShapeError(message: string): BlobMutationError {
  return new BlobMutationError(message, 400);
}

function isContentObjectKind(value: unknown): value is ContentObjectKind {
  return value === "blob" || value === "document";
}

function isContentRecordEncryptionSuite(
  value: unknown,
): value is ContentRecordEncryptionSuite {
  return value === CONTENT_RECORD_ENCRYPTION_SUITE;
}

function readStringClaim(value: unknown, key: string, label: string): string {
  if (!value || typeof value !== "object") {
    throw new BlobMutationError(`${label}.${key} is required`, 400);
  }

  const claim = Reflect.get(value, key);
  if (typeof claim !== "string" || claim.length === 0) {
    throw new BlobMutationError(`${label}.${key} is required`, 400);
  }

  return claim;
}

function readNullableStringClaim(
  value: unknown,
  key: string,
  label: string,
): string | null {
  if (!value || typeof value !== "object") {
    throw new BlobMutationError(`${label}.${key} is required`, 400);
  }

  const claim = Reflect.get(value, key);
  if (claim === null) {
    return null;
  }
  if (typeof claim !== "string" || claim.length === 0) {
    throw new BlobMutationError(`${label}.${key} is required`, 400);
  }

  return claim;
}

export function readBindBodyClaim(
  body: unknown,
): AttachmentBindAccessEventBody {
  return {
    eventType: "attachment.bind",
    bindingId: readStringClaim(body, "bindingId", "attachment.bind body"),
    blobId: readStringClaim(body, "blobId", "attachment.bind body"),
    documentId: readStringClaim(body, "documentId", "attachment.bind body"),
    slotId: readStringClaim(body, "slotId", "attachment.bind body"),
    expectedBindingId: readNullableStringClaim(
      body,
      "expectedBindingId",
      "attachment.bind body",
    ),
    documentManifestHash: readStringClaim(
      body,
      "documentManifestHash",
      "attachment.bind body",
    ),
  };
}

export function readDetachBodyClaim(
  body: unknown,
): AttachmentDetachAccessEventBody {
  return {
    eventType: "attachment.detach",
    bindingId: readStringClaim(body, "bindingId", "attachment.detach body"),
    blobId: readStringClaim(body, "blobId", "attachment.detach body"),
    documentId: readStringClaim(body, "documentId", "attachment.detach body"),
    slotId: readStringClaim(body, "slotId", "attachment.detach body"),
    documentManifestHash: readStringClaim(
      body,
      "documentManifestHash",
      "attachment.detach body",
    ),
  };
}

export function readBlobEvent(value: unknown, label: string): AccessEvent {
  return readProjectionAccessEvent(value, label, blobShapeError);
}

function readWriteHeaderString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  return readProjectionString(record, key, label, blobShapeError);
}

export function readWriteHeader(value: unknown, label: string): WriteHeader {
  const record = readProjectionPlainRecord(value, label, blobShapeError);
  const objectKind = readProjectionValue(record, "objectKind");
  const encryptionSuite = readProjectionValue(record, "encryptionSuite");
  if (!isContentObjectKind(objectKind)) {
    throw blobShapeError(`${label}.objectKind is invalid`);
  }
  if (!isContentRecordEncryptionSuite(encryptionSuite)) {
    throw blobShapeError(`${label}.encryptionSuite is invalid`);
  }
  readProjectionVersion(record, label, blobShapeError);

  return {
    version: 1,
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
      blobShapeError,
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

export function verifiedBlobKekTargetsFromResolved(
  targets: ResolvedBlobKekTargets,
): VerifiedBlobKekTargets {
  return makeVerifiedBlobKekTargets({
    blobId: targets.blobId,
    organizationId: targets.organizationId,
    activeBindingIds: [...targets.activeBindingIds],
    documentManifestHashes: [...targets.documentManifestHashes],
    linkedContainerManifestHashes: [...targets.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...targets.linkedContainerKeyEpochIds],
    targets: targets.targets.map((target) => ({ ...target })),
    blobKeyTargetHash: targets.blobKeyTargetHash,
    blobAccessManifestHash: targets.blobAccessManifestHash,
  });
}

function readContentKeyWrappingMetadata(
  value: unknown,
  label: string,
): KeyingCanonicalJson {
  return readProjectionCanonicalJson(value, label, blobShapeError);
}

function contentKeyWrappingMetadataRecord(
  value: KeyingCanonicalJson,
  label: string,
): Record<string, unknown> {
  return readProjectionRecord(value, label, blobShapeError);
}

function toStoredTargetEnvelope(
  target: BlobContentKeyTargetEnvelopeRequest,
): BlobContentKeyTargetEnvelope {
  return {
    bindingId: target.bindingId,
    documentId: target.documentId,
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
    wrappedKey: target.wrappedKey,
    wrappingMetadata: readContentKeyWrappingMetadata(
      target.wrappingMetadata,
      "Blob content-key target wrapping metadata",
    ),
  };
}

export function toStoredContentKeyBundleInput(
  blobId: string,
  bundle: BlobContentKeyBundleRequest,
) {
  return {
    blobId,
    contentKeyEpoch: bundle.contentKeyEpoch,
    targetHash: bundle.targetHash,
    targets: bundle.targets.map(toStoredTargetEnvelope),
  };
}

export function toContentKeyBundleResponse(input: {
  readonly blobId: string;
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): BlobContentKeyBundleResponse {
  return {
    blobId: input.blobId,
    contentKeyEpoch: input.contentKeyEpoch,
    targetHash: input.targetHash,
    targets: input.targets.map((target) => ({
      bindingId: target.bindingId,
      documentId: target.documentId,
      containerId: target.containerId,
      containerManifestHash: target.containerManifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      containerKeyEpoch: target.containerKeyEpoch,
      wrappedKey: target.wrappedKey,
      wrappingMetadata: contentKeyWrappingMetadataRecord(
        target.wrappingMetadata,
        "Blob content-key target wrapping metadata",
      ),
    })),
  };
}

function blobKekTargetsProjection(input: ResolvedBlobKekTargets) {
  return {
    blobId: input.blobId,
    organizationId: input.organizationId,
    activeBindingIds: [...input.activeBindingIds],
    documentManifestHashes: [...input.documentManifestHashes],
    linkedContainerManifestHashes: [...input.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...input.linkedContainerKeyEpochIds],
    targets: input.targets.map((target) => ({ ...target })),
    blobKeyTargetHash: input.blobKeyTargetHash,
    blobAccessManifestHash: input.blobAccessManifestHash,
  };
}

export function toBlobKekTargetsResponse(
  input: ResolvedBlobKekTargets,
): BlobKekTargetsResponse {
  return blobKekTargetsProjection(input);
}

export function toBlobWriteAuthorization(
  input: ResolvedBlobKekTargets,
): BlobWriteAuthorization {
  return blobKekTargetsProjection(input);
}

export function toBindResponse(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly blobId: string;
  readonly contentKeyBundle: StoredBlobContentKeyBundleWithTargets;
  readonly currentTargets: ResolvedBlobKekTargets;
  readonly writeHeader: WriteHeader;
  readonly writeHeaderHash: string;
  readonly writeAuthorization: BlobKekTargetsResponse;
}) {
  return {
    bindingEvent: projectionVerifiedAccessEventRecord(input.binding.event),
    bindingId: input.binding.bindingId,
    blobId: input.blobId,
    documentId: input.binding.documentId,
    documentManifestHash: input.binding.documentManifestHash,
    previousBindingId: input.binding.body.expectedBindingId,
    slotId: input.binding.slotId,
    contentKeyBundle: toContentKeyBundleResponse(input.contentKeyBundle),
    blobKekTargets: toBlobKekTargetsResponse(input.currentTargets),
    writeHeader: { ...input.writeHeader },
    writeHeaderHash: input.writeHeaderHash,
    writeAuthorization: { ...input.writeAuthorization },
  };
}
