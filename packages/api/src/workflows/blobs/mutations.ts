import type {
  AccessEvent,
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  ContentObjectKind,
  ContentRecordEncryptionSuite,
  KeyingCanonicalJson,
  VerifiedAttachmentBinding,
  VerifiedAttachmentDetach,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
  WriteHeader,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  KeyingVerificationError,
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
  verifyWriteHeader,
} from "@tearleads/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  BlobContentKeyBundleRequest,
  BlobContentKeyTargetEnvelopeRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
  BlobContentKeyBundleResponse,
  BlobKekTargetsResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";
import type {
  BlobContentKeyTargetEnvelope,
  StoredBlobContentKeyBundleWithTargets,
} from "../../access/read/blobContentKeyStore";
import {
  BlobKekTargetError,
  type resolveCurrentBlobKekTargets,
} from "../../access/read/blobKekTargets";
import {
  storeVerifiedAttachmentBindingInTransaction,
  storeVerifiedAttachmentDetachInTransaction,
} from "../../access/write/attachmentBindingStore";
import {
  BlobContentKeyBundleError,
  storeBlobContentKeyBundleInTransaction,
  storeBlobContentWriteHeader,
} from "../../access/write/blobContentKeyStore";
import type { ApiDatabase, DatabaseTransaction } from "../../adapters/postgres";
import { appendDocumentAttachmentAuditEntries } from "../../documents/documentAttachmentAuditEvents";
import { documentAuditAccessFromManifest } from "../../documents/documentAuditAccess";
import {
  loadPrincipalPoliciesForContainerPaths,
  PrincipalPolicyProjectionError,
} from "../../documents/principalPolicyProjection";
import {
  readProjectionAccessEvent,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionRecord,
  readProjectionString,
  readProjectionValue,
  readProjectionVersion,
} from "../../keyingProjectionRecords";
import { attachmentBindings, blobStages, blobs, documents } from "../../schema";
import {
  applyContainerRekeys,
  ContainerMutationError,
} from "../containers/mutations";
import {
  assertCurrentContainerPathGroups,
  assertDocumentManifestBundleConsistent,
  DocumentMutationError,
  loadSignerPublicKey,
} from "../documents/mutations";

type BlobMutationStatus = 400 | 403 | 404 | 409 | 503;

export class BlobMutationError extends Error {
  constructor(
    message: string,
    readonly status: BlobMutationStatus,
  ) {
    super(message);
    this.name = "BlobMutationError";
  }
}

export interface BindBlobAttachmentInput {
  readonly blobId: string;
  readonly fingerprint: string;
  readonly request: BlobAttachmentBindRequest;
  readonly userId: string;
}

export interface DetachBlobAttachmentInput {
  readonly bindingId: string;
  readonly blobId: string;
  readonly fingerprint: string;
  readonly request: BlobAttachmentDetachRequest;
  readonly userId: string;
}

interface AttachmentAuthorizationProof {
  readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}

type ActiveAttachmentBindingRow = Awaited<
  ReturnType<typeof loadActiveAttachmentBindingsForSlot>
>[number];

type UnbrandedVerified<T> = {
  readonly [K in keyof T as K extends symbol ? never : K]: T[K];
};

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

function mapVerificationStatus(
  error: KeyingVerificationError,
): BlobMutationStatus {
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

function toMutationError(error: unknown): BlobMutationError | null {
  if (error instanceof BlobMutationError) {
    return error;
  }

  if (error instanceof DocumentMutationError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof ContainerMutationError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof PrincipalPolicyProjectionError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof BlobContentKeyBundleError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof BlobKekTargetError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof KeyingVerificationError) {
    return new BlobMutationError(error.message, mapVerificationStatus(error));
  }

  return null;
}

function readStringClaim(value: unknown, key: string, label: string): string {
  if (
    !value ||
    typeof value !== "object" ||
    typeof Reflect.get(value, key) !== "string" ||
    (Reflect.get(value, key) as string).length === 0
  ) {
    throw new BlobMutationError(`${label}.${key} is required`, 400);
  }

  return Reflect.get(value, key) as string;
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

function readBindBodyClaim(body: unknown): AttachmentBindAccessEventBody {
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

function readDetachBodyClaim(body: unknown): AttachmentDetachAccessEventBody {
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

function readBlobEvent(value: unknown, label: string): AccessEvent {
  return readProjectionAccessEvent(value, label, blobShapeError);
}

function readWriteHeaderString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  return readProjectionString(record, key, label, blobShapeError);
}

function readWriteHeader(value: unknown, label: string): WriteHeader {
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

function verifiedBlobKekTargetsFromResolved(
  targets: Awaited<ReturnType<typeof resolveCurrentBlobKekTargets>>,
): VerifiedBlobKekTargets {
  const verified: UnbrandedVerified<VerifiedBlobKekTargets> = {
    blobId: targets.blobId,
    organizationId: targets.organizationId,
    activeBindingIds: [...targets.activeBindingIds],
    documentManifestHashes: [...targets.documentManifestHashes],
    linkedContainerManifestHashes: [...targets.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...targets.linkedContainerKeyEpochIds],
    targets: targets.targets.map((target) => ({ ...target })),
    blobKeyTargetHash: targets.blobKeyTargetHash,
    blobAccessManifestHash: targets.blobAccessManifestHash,
  };

  return verified as VerifiedBlobKekTargets;
}

function readContentKeyWrappingMetadata(
  value: unknown,
  label: string,
): KeyingCanonicalJson {
  return readProjectionRecord(
    value,
    label,
    blobShapeError,
  ) as KeyingCanonicalJson;
}

function contentKeyWrappingMetadataRecord(
  value: KeyingCanonicalJson,
  label: string,
): Record<string, unknown> {
  return readProjectionRecord(value, label, blobShapeError);
}

function assertAttachmentEventSession(input: {
  readonly blobId: string;
  readonly event: AccessEvent;
  readonly expectedEventType: AccessEvent["eventType"];
  readonly fingerprint: string;
  readonly userId: string;
}): void {
  if (
    input.event.signerUserId !== input.userId ||
    input.event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new BlobMutationError("Forbidden", 403);
  }

  if (input.event.eventType !== input.expectedEventType) {
    throw new BlobMutationError("Unexpected attachment event type", 400);
  }

  if (
    input.event.objectKind !== "blob" ||
    input.event.objectId !== input.blobId
  ) {
    throw new BlobMutationError("Blob id mismatch", 400);
  }
}

async function assertDocumentManifestCurrent(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}): Promise<void> {
  if (
    input.manifest.state.documentId !== input.documentId ||
    input.manifest.manifest.objectKind !== "document" ||
    input.manifest.manifest.objectId !== input.documentId
  ) {
    throw new BlobMutationError(
      "Attachment document manifest does not match body",
      409,
    );
  }

  const [document] = await input.executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) {
    throw new BlobMutationError("Document not found", 404);
  }

  const head = await getCurrentAccessManifestHead(
    "document",
    input.documentId,
    input.executor,
  );
  if (!head) {
    throw new BlobMutationError("Document link-set manifest head missing", 404);
  }
  if (head.manifestHash !== input.manifest.manifestHash) {
    throw new BlobMutationError("Document link-set manifest is stale", 409);
  }
}

async function verifyAttachmentAuthorizationProof(input: {
  readonly bodyDocumentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: BlobAttachmentBindRequest | BlobAttachmentDetachRequest;
}): Promise<AttachmentAuthorizationProof> {
  const [documentManifest, authorizingContainerPaths] = await Promise.all([
    assertDocumentManifestBundleConsistent(
      input.request.documentManifest,
      "documentManifest",
    ),
    assertCurrentContainerPathGroups(
      input.executor,
      input.request.authorizingContainerPaths,
      "authorizingContainerPaths",
    ),
  ]);
  await assertDocumentManifestCurrent({
    documentId: input.bodyDocumentId,
    executor: input.executor,
    manifest: documentManifest,
  });

  if (!authorizingContainerPaths || authorizingContainerPaths.length === 0) {
    throw new BlobMutationError(
      "Attachment authorization paths are required",
      400,
    );
  }

  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    authorizingContainerPaths,
  );

  return {
    authorizingContainerPaths,
    documentManifest,
    principalPolicies,
  };
}

async function loadActiveAttachmentBindingsForSlot(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly slotId: string;
}) {
  return input.executor
    .select({
      blobId: attachmentBindings.blobId,
      documentId: attachmentBindings.documentId,
      id: attachmentBindings.id,
      previousBindingId: attachmentBindings.previousBindingId,
      slotId: attachmentBindings.slotId,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, input.documentId),
        eq(attachmentBindings.slotId, input.slotId),
        isNull(attachmentBindings.detachedAt),
      ),
    );
}

async function requireSingleActiveAttachmentBindingForSlot(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly slotId: string;
}): Promise<ActiveAttachmentBindingRow | null> {
  const rows = await loadActiveAttachmentBindingsForSlot(input);
  if (rows.length > 1) {
    throw new BlobMutationError(
      "Attachment slot has multiple active bindings",
      409,
    );
  }

  return rows[0] ?? null;
}

async function loadActiveAttachmentBindingById(input: {
  readonly bindingId: string;
  readonly executor: DatabaseTransaction;
}) {
  const [binding] = await input.executor
    .select({
      blobId: attachmentBindings.blobId,
      documentId: attachmentBindings.documentId,
      id: attachmentBindings.id,
      previousBindingId: attachmentBindings.previousBindingId,
      slotId: attachmentBindings.slotId,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.id, input.bindingId),
        isNull(attachmentBindings.detachedAt),
      ),
    )
    .limit(1);

  return binding ?? null;
}

async function ensureBlobExists(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const [blob] = await input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  if (!blob) {
    throw new BlobMutationError("Blob not found", 404);
  }
}

async function promoteStagedBlobIfPresent(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
  readonly request: BlobAttachmentBindRequest;
  readonly userId: string;
}): Promise<{ readonly sha256: string } | null> {
  if (!input.request.stagedBlob) {
    await ensureBlobExists({
      blobId: input.blobId,
      executor: input.executor,
    });
    return null;
  }

  const [existingBlob] = await input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  if (existingBlob) {
    throw new BlobMutationError("Blob already exists", 409);
  }

  const [stage] = await input.executor
    .select({
      byteLength: blobStages.byteLength,
      encryptedBytes: blobStages.encryptedBytes,
      expiresAt: blobStages.expiresAt,
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
      sha256: blobStages.sha256,
    })
    .from(blobStages)
    .where(eq(blobStages.id, input.request.stagedBlob.stageId))
    .limit(1);

  if (!stage) {
    throw new BlobMutationError("Blob stage not found", 404);
  }
  if (stage.ownerUserId !== input.userId) {
    throw new BlobMutationError("Forbidden", 403);
  }
  if (stage.expiresAt.getTime() <= Date.now()) {
    throw new BlobMutationError("Blob stage has expired", 409);
  }

  await input.executor.insert(blobs).values({
    id: input.blobId,
    byteLength: stage.byteLength,
    encryptedBytes: stage.encryptedBytes,
    sha256: stage.sha256,
    storageKey: stage.id,
  });
  await input.executor.delete(blobStages).where(eq(blobStages.id, stage.id));

  return { sha256: stage.sha256 };
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

function toStoredContentKeyBundleInput(
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

function toContentKeyBundleResponse(input: {
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

function toBlobKekTargetsResponse(
  input: Awaited<ReturnType<typeof resolveCurrentBlobKekTargets>>,
): BlobKekTargetsResponse {
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

async function verifyAndStoreStagedBlobWriteHeader(input: {
  readonly blobId: string;
  readonly blobKekTargets: Awaited<
    ReturnType<typeof resolveCurrentBlobKekTargets>
  >;
  readonly proof: AttachmentAuthorizationProof;
  readonly request: BlobAttachmentBindRequest;
  readonly signingPublicKey: Uint8Array;
  readonly stagedBlob: { readonly sha256: string } | null;
  readonly userId: string;
  readonly executor: DatabaseTransaction;
}): Promise<string | undefined> {
  if (!input.request.stagedBlob) {
    return undefined;
  }
  if (!input.stagedBlob) {
    throw new BlobMutationError("Blob stage is required", 400);
  }

  const header = readWriteHeader(
    input.request.stagedBlob.writeHeader,
    "Blob write header",
  );
  if (
    header.writerUserId !== input.userId ||
    header.contentKeyEpoch !== input.request.contentKeyBundle.contentKeyEpoch ||
    header.contentRecordId !== input.blobId
  ) {
    throw new BlobMutationError(
      "Blob write header does not match request",
      400,
    );
  }
  if (header.ciphertextHash !== input.stagedBlob.sha256) {
    throw new BlobMutationError(
      "Blob write header ciphertext hash does not match staged bytes",
      409,
    );
  }

  const verified = await verifyWriteHeader({
    blobAuthorization: {
      authorizingContainerPaths: input.proof.authorizingContainerPaths,
      blobKekTargets: verifiedBlobKekTargetsFromResolved(input.blobKekTargets),
      principalPolicies: input.proof.principalPolicies,
    },
    expectedAccessManifestHash: input.blobKekTargets.blobAccessManifestHash,
    expectedObject: {
      objectKind: "blob",
      objectId: input.blobId,
      organizationId: input.blobKekTargets.organizationId,
    },
    expectedTargetHash: input.blobKekTargets.blobKeyTargetHash,
    header,
    writerPublicKey: input.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }

  await storeBlobContentWriteHeader(
    {
      blobId: input.blobId,
      header: verified.value.header,
      headerHash: verified.value.headerHash,
      recordId: input.blobId,
    },
    input.executor,
  );

  return verified.value.headerHash;
}

async function detachActiveSlotBinding(input: {
  readonly activeBinding: ActiveAttachmentBindingRow | null;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  if (!input.activeBinding) {
    return;
  }

  await input.executor
    .update(attachmentBindings)
    .set({ detachedAt: sql`now()` })
    .where(eq(attachmentBindings.id, input.activeBinding.id));
}

async function appendAttachmentAuditEvent(input: {
  readonly activeBinding: ActiveAttachmentBindingRow | null;
  readonly binding: VerifiedAttachmentBinding;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly userId: string;
}): Promise<void> {
  const auditAccess = await documentAuditAccessFromManifest(input.manifest);

  await appendDocumentAttachmentAuditEntries(input.executor, {
    ...auditAccess,
    actorFingerprint: input.fingerprint,
    actorUserId: input.userId,
    documentId: input.binding.documentId,
    events: [
      {
        action: input.activeBinding ? "replace" : "attach",
        bindingId: input.binding.bindingId,
        blobId: input.binding.blobId,
        previousBindingId: input.activeBinding?.id ?? null,
        previousBlobId: input.activeBinding?.blobId ?? null,
        slotId: input.binding.slotId,
      },
    ],
  });
}

async function appendAttachmentDetachAuditEvent(input: {
  readonly detach: VerifiedAttachmentDetach;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly userId: string;
}): Promise<void> {
  const auditAccess = await documentAuditAccessFromManifest(input.manifest);

  await appendDocumentAttachmentAuditEntries(input.executor, {
    ...auditAccess,
    actorFingerprint: input.fingerprint,
    actorUserId: input.userId,
    documentId: input.detach.documentId,
    events: [
      {
        action: "detach",
        bindingId: input.detach.bindingId,
        blobId: input.detach.blobId,
        previousBindingId: null,
        previousBlobId: null,
        slotId: input.detach.slotId,
      },
    ],
  });
}

function toBindResponse(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly blobId: string;
  readonly contentKeyBundle: StoredBlobContentKeyBundleWithTargets;
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentBlobKekTargets>
  >;
  readonly writeHeaderHash: string | undefined;
}): BlobAttachmentBindResponse {
  return {
    bindingId: input.binding.bindingId,
    blobId: input.blobId,
    documentId: input.binding.documentId,
    slotId: input.binding.slotId,
    contentKeyBundle: toContentKeyBundleResponse(input.contentKeyBundle),
    blobKekTargets: toBlobKekTargetsResponse(input.currentTargets),
    ...(input.writeHeaderHash
      ? { writeHeaderHash: input.writeHeaderHash }
      : {}),
  };
}

async function applyAttachmentContainerRekeys(input: {
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: BlobAttachmentBindRequest | BlobAttachmentDetachRequest;
  readonly userId: string;
}): Promise<void> {
  // Attachment writes accept signed container.rekey payloads before reading
  // current authorization paths or KEK targets, so stale key material can be
  // repaired in the same transaction as the blob write.
  await applyContainerRekeys({
    executor: input.executor,
    fingerprint: input.fingerprint,
    requests: input.request.containerRekeys,
    userId: input.userId,
  });
}

function readBindRequestSession(input: BindBlobAttachmentInput) {
  const bindBody = readBindBodyClaim(input.request.body);
  const event = readBlobEvent(input.request.event, "Blob event");
  assertAttachmentEventSession({
    blobId: input.blobId,
    event,
    expectedEventType: "attachment.bind",
    fingerprint: input.fingerprint,
    userId: input.userId,
  });
  if (bindBody.blobId !== input.blobId) {
    throw new BlobMutationError("Blob id mismatch", 400);
  }

  return { bindBody, event };
}

async function bindBlobAttachmentTransaction(
  input: BindBlobAttachmentInput,
  tx: DatabaseTransaction,
): Promise<BlobAttachmentBindResponse> {
  const { bindBody, event } = readBindRequestSession(input);
  await applyAttachmentContainerRekeys({
    executor: tx,
    fingerprint: input.fingerprint,
    request: input.request,
    userId: input.userId,
  });
  const [signingPublicKey, proof] = await Promise.all([
    loadSignerPublicKey(tx, input),
    verifyAttachmentAuthorizationProof({
      bodyDocumentId: bindBody.documentId,
      executor: tx,
      request: input.request,
    }),
  ]);
  const activeBinding = await requireSingleActiveAttachmentBindingForSlot({
    documentId: bindBody.documentId,
    executor: tx,
    slotId: bindBody.slotId,
  });
  const verifiedBinding = await verifyAttachmentBindingEvent({
    authorizingContainerPaths: proof.authorizingContainerPaths,
    body: input.request.body as KeyingCanonicalJson,
    documentManifest: proof.documentManifest,
    event,
    expectedBindingId: bindBody.bindingId,
    expectedBlobId: input.blobId,
    expectedDocumentId: bindBody.documentId,
    expectedDocumentManifestHash: proof.documentManifest.manifestHash,
    expectedPreviousBindingId: activeBinding?.id ?? null,
    principalPolicies: proof.principalPolicies,
    signerPublicKey: signingPublicKey,
  });
  if (!verifiedBinding.ok) {
    throw verifiedBinding.error;
  }

  const stagedBlob = await promoteStagedBlobIfPresent({
    blobId: input.blobId,
    executor: tx,
    request: input.request,
    userId: input.userId,
  });
  await detachActiveSlotBinding({ activeBinding, executor: tx });
  await storeVerifiedAttachmentBindingInTransaction(verifiedBinding.value, tx);
  const contentKeyBundle = await storeBlobContentKeyBundleInTransaction(
    toStoredContentKeyBundleInput(input.blobId, input.request.contentKeyBundle),
    tx,
  );
  const currentTargets = contentKeyBundle.currentTargets;
  const writeHeaderHash = await verifyAndStoreStagedBlobWriteHeader({
    blobId: input.blobId,
    blobKekTargets: currentTargets,
    executor: tx,
    proof,
    request: input.request,
    signingPublicKey,
    stagedBlob,
    userId: input.userId,
  });
  await appendAttachmentAuditEvent({
    activeBinding,
    binding: verifiedBinding.value,
    executor: tx,
    fingerprint: input.fingerprint,
    manifest: proof.documentManifest,
    userId: input.userId,
  });

  return toBindResponse({
    binding: verifiedBinding.value,
    blobId: input.blobId,
    contentKeyBundle,
    currentTargets,
    writeHeaderHash,
  });
}

export async function runBindBlobAttachmentWorkflow(
  db: ApiDatabase,
  input: BindBlobAttachmentInput,
): Promise<BlobAttachmentBindResponse> {
  try {
    return await db.transaction((tx) =>
      bindBlobAttachmentTransaction(input, tx),
    );
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

export async function runDetachBlobAttachmentWorkflow(
  db: ApiDatabase,
  input: DetachBlobAttachmentInput,
): Promise<BlobAttachmentDetachResponse> {
  try {
    return await db.transaction(async (tx) => {
      const detachBody = readDetachBodyClaim(input.request.body);
      const event = readBlobEvent(input.request.event, "Blob event");
      assertAttachmentEventSession({
        blobId: input.blobId,
        event,
        expectedEventType: "attachment.detach",
        fingerprint: input.fingerprint,
        userId: input.userId,
      });
      if (
        detachBody.blobId !== input.blobId ||
        detachBody.bindingId !== input.bindingId
      ) {
        throw new BlobMutationError("Attachment binding mismatch", 400);
      }

      const activeBinding = await loadActiveAttachmentBindingById({
        bindingId: input.bindingId,
        executor: tx,
      });
      if (!activeBinding) {
        throw new BlobMutationError("Attachment binding is not active", 409);
      }

      await applyAttachmentContainerRekeys({
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request,
        userId: input.userId,
      });
      const [signingPublicKey, proof] = await Promise.all([
        loadSignerPublicKey(tx, input),
        verifyAttachmentAuthorizationProof({
          bodyDocumentId: detachBody.documentId,
          executor: tx,
          request: input.request,
        }),
      ]);
      const verifiedDetach = await verifyAttachmentDetachEvent({
        authorizingContainerPaths: proof.authorizingContainerPaths,
        body: input.request.body as KeyingCanonicalJson,
        documentManifest: proof.documentManifest,
        event,
        expectedBindingId: activeBinding.id,
        expectedBlobId: activeBinding.blobId,
        expectedDocumentId: activeBinding.documentId,
        expectedDocumentManifestHash: proof.documentManifest.manifestHash,
        principalPolicies: proof.principalPolicies,
        signerPublicKey: signingPublicKey,
      });
      if (!verifiedDetach.ok) {
        throw verifiedDetach.error;
      }

      await storeVerifiedAttachmentDetachInTransaction(
        verifiedDetach.value,
        tx,
      );
      await appendAttachmentDetachAuditEvent({
        detach: verifiedDetach.value,
        executor: tx,
        fingerprint: input.fingerprint,
        manifest: proof.documentManifest,
        userId: input.userId,
      });

      return {
        bindingId: verifiedDetach.value.bindingId,
        blobId: verifiedDetach.value.blobId,
        documentId: verifiedDetach.value.documentId,
        slotId: verifiedDetach.value.slotId,
      };
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
