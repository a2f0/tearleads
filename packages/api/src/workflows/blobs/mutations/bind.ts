import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  verifyAttachmentBindingEvent,
  verifyWriteHeader,
} from "@tearleads/crypto";
import type { BlobAttachmentBindResponse } from "@tearleads/validators/response";
import { lockAccessManifestHeadsForShare } from "../../../access/read/accessManifestStore";
import { storeVerifiedAttachmentBindingInTransaction } from "../../../access/write/attachmentBindingStore";
import {
  storeBlobContentKeyBundleInTransaction,
  storeBlobContentWriteHeader,
} from "../../../access/write/blobContentKeyStore";
import { readKeyingCanonicalJson } from "../../../utils/canonicalJson";
import { touchDocumentAndLinkedContainers } from "../../documents/mutations/shared/documentRows";
import { loadSignerPublicKey } from "../../signerPublicKey";
import {
  type AttachmentAuthorizationProof,
  applyAttachmentContainerRekeys,
  assertAttachmentOrganizationCanSync,
  readBindRequestSession,
  verifyAttachmentAuthorizationProof,
} from "./authorization";
import { toMutationError } from "./errors";
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
      blobId: input.blobId,
      header: verified.value.header,
      headerHash: verified.value.headerHash,
      recordId: input.blobId,
    },
    input.executor,
  );

  return verified.value.headerHash;
}

// Serialize the blob content-key write against a concurrent container.rekey on
// any authorizing container — same hazard as document sync. Under READ COMMITTED
// a rekey committing between the current blob-KEK-target resolution and the
// content-key-bundle write would wrap the blob content key to a superseded
// (pre-revocation) recipient set. FOR SHARE on the linked container heads blocks
// such a rekey until this bind commits (or fails closed on a stale target hash
// if the rekey already committed).
async function lockBindAuthorizingContainersForShare(
  proof: AttachmentAuthorizationProof,
  tx: DatabaseTransaction,
): Promise<void> {
  await lockAccessManifestHeadsForShare(
    "container",
    proof.documentManifest.state.linkedContainerIds,
    tx,
  );
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
  // Run sequentially: both queries share the single transaction
  // connection, so issuing them concurrently only trips pg's
  // already-executing-query deprecation without any real parallelism.
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
  await lockBindAuthorizingContainersForShare(proof, tx);
  const activeBinding = await requireSingleActiveAttachmentBindingForSlot({
    documentId: bindBody.documentId,
    executor: tx,
    slotId: bindBody.slotId,
  });
  const verifiedBinding = await verifyAttachmentBindingEvent({
    authorizingContainerPaths: proof.authorizingContainerPaths,
    body: readKeyingCanonicalJson(
      input.request.body,
      "Blob attachment bind body",
    ),
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
    prevalidatedMultipartStage: input.prevalidatedMultipartStage,
    request: input.request,
    userId: input.userId,
  });
  await detachActiveSlotBinding({ activeBinding, executor: tx });
  await storeVerifiedAttachmentBindingInTransaction(verifiedBinding.value, tx);
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
  await appendAttachmentAuditEvent({
    activeBinding,
    binding: verifiedBinding.value,
    executor: tx,
    fingerprint: input.fingerprint,
    manifest: proof.documentManifest,
    userId: input.userId,
  });
  await touchDocumentAndLinkedContainers(tx, {
    documentId: verifiedBinding.value.documentId,
    linkedContainerIds: proof.documentManifest.state.linkedContainerIds,
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
