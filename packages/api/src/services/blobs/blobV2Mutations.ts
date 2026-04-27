import type {
  AccessEventV2,
  AttachmentBindAccessEventBodyV2,
  AttachmentDetachAccessEventBodyV2,
  KeyingV2CanonicalJson,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
  WriteHeaderV2,
} from "@tearleads/crypto";
import {
  KeyingV2VerificationError,
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
  verifyWriteHeader,
} from "@tearleads/crypto";
import type {
  BlobV2AttachmentBindRequest,
  BlobV2AttachmentDetachRequest,
  BlobV2ContentKeyBundleRequest,
  BlobV2ContentKeyTargetEnvelopeRequest,
} from "@tearleads/validators/request";
import type {
  BlobV2AttachmentBindResponse,
  BlobV2AttachmentDetachResponse,
  BlobV2ContentKeyBundleResponse,
  BlobV2KekTargetsResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import { getCurrentAccessManifestHead } from "../../access/accessManifestStore";
import {
  storeVerifiedAttachmentBinding,
  storeVerifiedAttachmentDetach,
} from "../../access/attachmentBindingStore";
import {
  BlobContentKeyBundleError,
  type BlobContentKeyTargetEnvelope,
  storeBlobContentKeyBundle,
  storeBlobContentWriteHeader,
} from "../../access/blobContentKeyStore";
import {
  BlobKekTargetError,
  resolveCurrentBlobKekTargets,
} from "../../access/blobKekTargets";
import type { DatabaseExecutor } from "../../adapters/postgres";
import { attachmentBindings, blobStages, blobs, documents } from "../../schema";
import {
  assertCurrentContainerPathGroups,
  assertDocumentManifestBundleConsistent,
  DocumentV2MutationError,
  loadPrincipalPoliciesForContainerPaths,
  loadSignerPublicKey,
} from "../documents/documentV2Mutations";
import type { ApiServiceRuntime } from "../runtime";

type BlobV2MutationStatus = 400 | 403 | 404 | 409 | 503;

export class BlobV2MutationError extends Error {
  constructor(
    message: string,
    readonly status: BlobV2MutationStatus,
  ) {
    super(message);
    this.name = "BlobV2MutationError";
  }
}

interface BindBlobAttachmentV2Input {
  readonly blobId: string;
  readonly fingerprint: string;
  readonly request: BlobV2AttachmentBindRequest;
  readonly userId: string;
}

interface DetachBlobAttachmentV2Input {
  readonly bindingId: string;
  readonly blobId: string;
  readonly fingerprint: string;
  readonly request: BlobV2AttachmentDetachRequest;
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

function mapVerificationStatus(
  error: KeyingV2VerificationError,
): BlobV2MutationStatus {
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

function toMutationError(error: unknown): BlobV2MutationError | null {
  if (error instanceof BlobV2MutationError) {
    return error;
  }

  if (error instanceof DocumentV2MutationError) {
    return new BlobV2MutationError(error.message, error.status);
  }

  if (error instanceof BlobContentKeyBundleError) {
    return new BlobV2MutationError(error.message, error.status);
  }

  if (error instanceof BlobKekTargetError) {
    return new BlobV2MutationError(error.message, error.status);
  }

  if (error instanceof KeyingV2VerificationError) {
    return new BlobV2MutationError(error.message, mapVerificationStatus(error));
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
    throw new BlobV2MutationError(`${label}.${key} is required`, 400);
  }

  return Reflect.get(value, key) as string;
}

function readNullableStringClaim(
  value: unknown,
  key: string,
  label: string,
): string | null {
  if (!value || typeof value !== "object") {
    throw new BlobV2MutationError(`${label}.${key} is required`, 400);
  }

  const claim = Reflect.get(value, key);
  if (claim === null) {
    return null;
  }
  if (typeof claim !== "string" || claim.length === 0) {
    throw new BlobV2MutationError(`${label}.${key} is required`, 400);
  }

  return claim;
}

function readBindBodyClaim(body: unknown): AttachmentBindAccessEventBodyV2 {
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

function readDetachBodyClaim(body: unknown): AttachmentDetachAccessEventBodyV2 {
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

function assertAttachmentEventSession(input: {
  readonly blobId: string;
  readonly event: AccessEventV2;
  readonly expectedEventType: AccessEventV2["eventType"];
  readonly fingerprint: string;
  readonly userId: string;
}): void {
  if (
    input.event.signerUserId !== input.userId ||
    input.event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new BlobV2MutationError("Forbidden", 403);
  }

  if (input.event.eventType !== input.expectedEventType) {
    throw new BlobV2MutationError("Unexpected attachment event type", 400);
  }

  if (
    input.event.objectKind !== "blob" ||
    input.event.objectId !== input.blobId
  ) {
    throw new BlobV2MutationError("Blob id mismatch", 400);
  }
}

async function assertDocumentManifestCurrent(input: {
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}): Promise<void> {
  if (
    input.manifest.state.documentId !== input.documentId ||
    input.manifest.manifest.objectKind !== "document" ||
    input.manifest.manifest.objectId !== input.documentId
  ) {
    throw new BlobV2MutationError(
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
    throw new BlobV2MutationError("Document not found", 404);
  }

  const head = await getCurrentAccessManifestHead(
    "document",
    input.documentId,
    input.executor,
  );
  if (!head) {
    throw new BlobV2MutationError(
      "Document link-set manifest head missing",
      404,
    );
  }
  if (head.manifestHash !== input.manifest.manifestHash) {
    throw new BlobV2MutationError("Document link-set manifest is stale", 409);
  }
}

async function verifyAttachmentAuthorizationProof(input: {
  readonly bodyDocumentId: string;
  readonly executor: DatabaseExecutor;
  readonly request: BlobV2AttachmentBindRequest | BlobV2AttachmentDetachRequest;
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
    throw new BlobV2MutationError(
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
  readonly executor: DatabaseExecutor;
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
  readonly executor: DatabaseExecutor;
  readonly slotId: string;
}): Promise<ActiveAttachmentBindingRow | null> {
  const rows = await loadActiveAttachmentBindingsForSlot(input);
  if (rows.length > 1) {
    throw new BlobV2MutationError(
      "Attachment slot has multiple active bindings",
      409,
    );
  }

  return rows[0] ?? null;
}

async function loadActiveAttachmentBindingById(input: {
  readonly bindingId: string;
  readonly executor: DatabaseExecutor;
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
  readonly executor: DatabaseExecutor;
}): Promise<void> {
  const [blob] = await input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  if (!blob) {
    throw new BlobV2MutationError("Blob not found", 404);
  }
}

async function promoteStagedBlobIfPresent(input: {
  readonly blobId: string;
  readonly executor: DatabaseExecutor;
  readonly request: BlobV2AttachmentBindRequest;
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
    throw new BlobV2MutationError("Blob already exists", 409);
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
    throw new BlobV2MutationError("Blob stage not found", 404);
  }
  if (stage.ownerUserId !== input.userId) {
    throw new BlobV2MutationError("Forbidden", 403);
  }
  if (stage.expiresAt.getTime() <= Date.now()) {
    throw new BlobV2MutationError("Blob stage has expired", 409);
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
  target: BlobV2ContentKeyTargetEnvelopeRequest,
): BlobContentKeyTargetEnvelope {
  return {
    bindingId: target.bindingId,
    documentId: target.documentId,
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
    wrappedKey: target.wrappedKey,
    wrappingMetadata: target.wrappingMetadata as KeyingV2CanonicalJson,
  };
}

function toStoredContentKeyBundleInput(
  blobId: string,
  bundle: BlobV2ContentKeyBundleRequest,
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
}): BlobV2ContentKeyBundleResponse {
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
      wrappingMetadata: target.wrappingMetadata as Record<string, unknown>,
    })),
  };
}

function toBlobKekTargetsResponse(
  input: Awaited<ReturnType<typeof resolveCurrentBlobKekTargets>>,
): BlobV2KekTargetsResponse {
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
  readonly request: BlobV2AttachmentBindRequest;
  readonly signingPublicKey: Uint8Array;
  readonly stagedBlob: { readonly sha256: string } | null;
  readonly userId: string;
  readonly executor: DatabaseExecutor;
}): Promise<string | undefined> {
  if (!input.request.stagedBlob) {
    return undefined;
  }
  if (!input.stagedBlob) {
    throw new BlobV2MutationError("Blob stage is required", 400);
  }

  const header = input.request.stagedBlob
    .writeHeader as unknown as WriteHeaderV2;
  if (
    header.writerUserId !== input.userId ||
    header.contentKeyEpoch !== input.request.contentKeyBundle.contentKeyEpoch ||
    header.contentRecordId !== input.blobId
  ) {
    throw new BlobV2MutationError(
      "Blob write header does not match request",
      400,
    );
  }
  if (header.ciphertextHash !== input.stagedBlob.sha256) {
    throw new BlobV2MutationError(
      "Blob write header ciphertext hash does not match staged bytes",
      409,
    );
  }

  const verified = await verifyWriteHeader({
    blobAuthorization: {
      authorizingContainerPaths: input.proof.authorizingContainerPaths,
      blobKekTargets: input.blobKekTargets as unknown as VerifiedBlobKekTargets,
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
  readonly executor: DatabaseExecutor;
}): Promise<void> {
  if (!input.activeBinding) {
    return;
  }

  await input.executor
    .update(attachmentBindings)
    .set({ detachedAt: new Date() })
    .where(eq(attachmentBindings.id, input.activeBinding.id));
}

function toBindResponse(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly blobId: string;
  readonly contentKeyBundle: Awaited<
    ReturnType<typeof storeBlobContentKeyBundle>
  >;
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentBlobKekTargets>
  >;
  readonly writeHeaderHash: string | undefined;
}): BlobV2AttachmentBindResponse {
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

export async function bindBlobAttachmentV2(
  runtime: ApiServiceRuntime,
  input: BindBlobAttachmentV2Input,
): Promise<BlobV2AttachmentBindResponse> {
  try {
    return await runtime.db.transaction(async (tx) => {
      const bindBody = readBindBodyClaim(input.request.body);
      const event = input.request.event as unknown as AccessEventV2;
      assertAttachmentEventSession({
        blobId: input.blobId,
        event,
        expectedEventType: "attachment.bind",
        fingerprint: input.fingerprint,
        userId: input.userId,
      });
      if (bindBody.blobId !== input.blobId) {
        throw new BlobV2MutationError("Blob id mismatch", 400);
      }

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
        body: input.request.body as KeyingV2CanonicalJson,
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
      await storeVerifiedAttachmentBinding(verifiedBinding.value, tx);
      const currentTargets = await resolveCurrentBlobKekTargets(
        input.blobId,
        tx,
      );
      const contentKeyBundle = await storeBlobContentKeyBundle(
        toStoredContentKeyBundleInput(
          input.blobId,
          input.request.contentKeyBundle,
        ),
        tx,
      );
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

      return toBindResponse({
        binding: verifiedBinding.value,
        blobId: input.blobId,
        contentKeyBundle,
        currentTargets,
        writeHeaderHash,
      });
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}

export async function detachBlobAttachmentV2(
  runtime: ApiServiceRuntime,
  input: DetachBlobAttachmentV2Input,
): Promise<BlobV2AttachmentDetachResponse> {
  try {
    return await runtime.db.transaction(async (tx) => {
      const detachBody = readDetachBodyClaim(input.request.body);
      const event = input.request.event as unknown as AccessEventV2;
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
        throw new BlobV2MutationError("Attachment binding mismatch", 400);
      }

      const activeBinding = await loadActiveAttachmentBindingById({
        bindingId: input.bindingId,
        executor: tx,
      });
      if (!activeBinding) {
        throw new BlobV2MutationError("Attachment binding is not active", 409);
      }

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
        body: input.request.body as KeyingV2CanonicalJson,
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

      await storeVerifiedAttachmentDetach(verifiedDetach.value, tx);

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
