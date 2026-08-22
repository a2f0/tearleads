import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import {
  verifyAttachmentBindingEvent,
  verifyWriteHeader,
} from "@symcrypt/crypto";
import type { BlobAttachmentBindResponse } from "@symcrypt/validators/response";
import { listBlobContentWriteHeaders } from "../../../access/read/blobContentKeyStore";
import { storeVerifiedAttachmentBindingInTransaction } from "../../../access/write/attachmentBindingStore";
import {
  storeBlobContentKeyBundleInTransaction,
  storeBlobContentWriteHeader,
} from "../../../access/write/blobContentKeyStore";
import { readKeyingCanonicalJson } from "../../../utils/canonicalJson";
import { loadSignerPublicKey } from "../../signerPublicKey";
import {
  type AttachmentAuthorizationProof,
  applyAttachmentContainerRekeys,
  assertAttachmentOrganizationCanSync,
  assertStoredBlobOrganizationMatches,
  lockAttachmentAuthorizationForShare,
  readBindRequestSession,
  verifyAttachmentAuthorizationProof,
} from "./authorization";
import { lockBlobMutationRows } from "./blobMutationLocks";
import { toMutationError } from "./errors";
import { finalizeAttachmentMutation } from "./finalizeAttachmentMutation";
import {
  appendAttachmentAuditEvent,
  detachActiveSlotBinding,
  promoteStagedBlobIfPresent,
  requireSingleActiveAttachmentBindingForSlot,
  reviveBlobIfDereferenced,
} from "./persistence";
import {
  type ResolvedBlobKekTargets,
  readWriteHeader,
  toBindResponse,
  toBlobKekTargetsResponse,
  toBlobWriteAuthorization,
  toStoredContentKeyBundleInput,
  verifiedBlobKekTargetsFromResolved,
} from "./records";
import {
  type BindBlobAttachmentInput,
  BlobMutationError,
  type PrevalidatedMultipartBlobStage,
} from "./types";

async function verifyAndStoreStagedBlobWriteHeader(input: {
  readonly blobId: string;
  readonly blobKekTargets: ResolvedBlobKekTargets;
  readonly proof: AttachmentAuthorizationProof;
  readonly request: BindBlobAttachmentInput["request"];
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
      authorization: toBlobWriteAuthorization(input.blobKekTargets),
      blobId: input.blobId,
      header: verified.value.header,
      headerHash: verified.value.headerHash,
      recordId: input.blobId,
    },
    input.executor,
  );

  return verified.value.headerHash;
}

async function requireBlobWriteHeader(
  blobId: string,
  executor: DatabaseTransaction,
) {
  const stored = (await listBlobContentWriteHeaders([blobId], executor)).get(
    blobId,
  );
  if (!stored) {
    throw new BlobMutationError("Blob write header is missing", 409);
  }
  return stored;
}

async function verifyBindEvent(input: {
  readonly activeBinding: Awaited<
    ReturnType<typeof requireSingleActiveAttachmentBindingForSlot>
  >;
  readonly bindBody: ReturnType<typeof readBindRequestSession>["bindBody"];
  readonly blobId: string;
  readonly event: ReturnType<typeof readBindRequestSession>["event"];
  readonly proof: AttachmentAuthorizationProof;
  readonly request: BindBlobAttachmentInput["request"];
  readonly signingPublicKey: Uint8Array;
}) {
  const verified = await verifyAttachmentBindingEvent({
    authorizingContainerPaths: input.proof.authorizingContainerPaths,
    body: readKeyingCanonicalJson(
      input.request.body,
      "Blob attachment bind body",
    ),
    documentManifest: input.proof.documentManifest,
    event: input.event,
    expectedBindingId: input.bindBody.bindingId,
    expectedBlobId: input.blobId,
    expectedDocumentId: input.bindBody.documentId,
    expectedDocumentManifestHash: input.proof.documentManifest.manifestHash,
    expectedPreviousBindingId: input.activeBinding?.id ?? null,
    principalPolicies: input.proof.principalPolicies,
    signerPublicKey: input.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  return verified.value;
}

async function verifyAndLockBindSlot(input: {
  readonly bindBody: ReturnType<typeof readBindRequestSession>["bindBody"];
  readonly event: ReturnType<typeof readBindRequestSession>["event"];
  readonly proof: AttachmentAuthorizationProof;
  readonly request: BindBlobAttachmentInput["request"];
  readonly signingPublicKey: Uint8Array;
  readonly blobId: string;
  readonly tx: DatabaseTransaction;
}) {
  const observedActiveBinding =
    await requireSingleActiveAttachmentBindingForSlot({
      documentId: input.bindBody.documentId,
      executor: input.tx,
      slotId: input.bindBody.slotId,
    });
  const verifiedBinding = await verifyBindEvent({
    activeBinding: observedActiveBinding,
    bindBody: input.bindBody,
    blobId: input.blobId,
    event: input.event,
    proof: input.proof,
    request: input.request,
    signingPublicKey: input.signingPublicKey,
  });
  await lockBlobMutationRows({
    blobIds: [
      input.blobId,
      ...(observedActiveBinding ? [observedActiveBinding.blobId] : []),
    ],
    executor: input.tx,
  });
  await assertStoredBlobOrganizationMatches({
    blobId: input.blobId,
    executor: input.tx,
    expectedOrganizationId: input.proof.documentManifest.state.organizationId,
  });
  const activeBinding = await requireSingleActiveAttachmentBindingForSlot({
    documentId: input.bindBody.documentId,
    executor: input.tx,
    slotId: input.bindBody.slotId,
  });
  if (activeBinding?.id !== observedActiveBinding?.id) {
    throw new BlobMutationError("Attachment slot changed concurrently", 409);
  }
  return { activeBinding, verifiedBinding };
}

function lockBindAttachmentAuthorization(
  input: BindBlobAttachmentInput,
  documentId: string,
  proof: AttachmentAuthorizationProof,
  tx: DatabaseTransaction,
): Promise<void> {
  return lockAttachmentAuthorizationForShare({
    blobId: input.blobId,
    contentKeyTargets: input.request.contentKeyBundle.targets,
    documentId,
    executor: tx,
    proof,
    request: input.request,
  });
}

async function bindBlobAttachmentTransaction(
  input: BindBlobAttachmentInput & {
    readonly prevalidatedMultipartStage: PrevalidatedMultipartBlobStage | null;
  },
  tx: DatabaseTransaction,
): Promise<BlobAttachmentBindResponse> {
  const { bindBody, event } = readBindRequestSession(input);
  await applyAttachmentContainerRekeys({
    executor: tx,
    fingerprint: input.fingerprint,
    request: input.request,
    userId: input.userId,
  });
  // These queries share one transaction connection, so run sequentially.
  const signingPublicKey = await loadSignerPublicKey(tx, {
    ...input,
    error: (message, status) => new BlobMutationError(message, status),
  });
  const proof = await verifyAttachmentAuthorizationProof({
    bodyDocumentId: bindBody.documentId,
    executor: tx,
    request: input.request,
  });
  await assertAttachmentOrganizationCanSync(tx, proof, input.userId);
  await lockBindAttachmentAuthorization(input, bindBody.documentId, proof, tx);
  const { activeBinding, verifiedBinding } = await verifyAndLockBindSlot({
    bindBody,
    blobId: input.blobId,
    event,
    proof,
    request: input.request,
    signingPublicKey,
    tx,
  });
  const stagedBlob = await promoteStagedBlobIfPresent({
    blobId: input.blobId,
    executor: tx,
    expectedOrganizationId: proof.documentManifest.state.organizationId,
    prevalidatedMultipartStage: input.prevalidatedMultipartStage,
    request: input.request,
    userId: input.userId,
  });
  if (!input.request.stagedBlob) {
    // An absent blob cannot be row-locked during the earlier authorization
    // checks. ensureBlobExists above has now locked the row, so repeat the
    // ownership check in case another organization created it in that window.
    await assertStoredBlobOrganizationMatches({
      blobId: input.blobId,
      executor: tx,
      expectedOrganizationId: proof.documentManifest.state.organizationId,
    });
  }
  await detachActiveSlotBinding({ activeBinding, executor: tx });
  await storeVerifiedAttachmentBindingInTransaction(verifiedBinding, tx);
  // The blob now has an active binding again; clear any prior purge soft-delete
  // so the GC sweep does not reclaim a blob this bind just re-referenced.
  await reviveBlobIfDereferenced({ blobId: input.blobId, executor: tx });
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
  // Intentional verification flag day: a legacy blob without a persisted
  // signed write header cannot be re-bound because the receiving client would
  // have no independent proof of who wrote its ciphertext.
  const storedWriteHeader = await requireBlobWriteHeader(input.blobId, tx);
  await appendAttachmentAuditEvent({
    activeBinding,
    binding: verifiedBinding,
    executor: tx,
    fingerprint: input.fingerprint,
    manifest: proof.documentManifest,
    userId: input.userId,
  });
  await finalizeAttachmentMutation({
    ...(activeBinding ? { dereferencedBlobId: activeBinding.blobId } : {}),
    documentId: verifiedBinding.documentId,
    executor: tx,
    linkedContainerIds: proof.documentManifest.state.linkedContainerIds,
  });
  return toBindResponse({
    binding: verifiedBinding,
    blobId: input.blobId,
    contentKeyBundle,
    currentTargets,
    writeHeader: storedWriteHeader.header,
    writeHeaderHash: writeHeaderHash ?? storedWriteHeader.headerHash,
    writeAuthorization: storedWriteHeader.authorization
      ? toBlobKekTargetsResponse(storedWriteHeader.authorization)
      : undefined,
  });
}

export async function runBindBlobAttachmentWorkflow(
  db: ApiDatabase,
  input: BindBlobAttachmentInput & {
    readonly prevalidatedMultipartStage?: PrevalidatedMultipartBlobStage | null;
  },
): Promise<BlobAttachmentBindResponse> {
  try {
    return await db.transaction(async (tx) => {
      const result = await bindBlobAttachmentTransaction(
        {
          ...input,
          prevalidatedMultipartStage: input.prevalidatedMultipartStage ?? null,
        },
        tx,
      );
      return result;
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
