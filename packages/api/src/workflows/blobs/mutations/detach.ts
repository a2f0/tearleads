import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import { verifyAttachmentDetachEvent } from "@symcrypt/crypto";
import { storeVerifiedAttachmentDetachInTransaction } from "../../../access/write/attachmentBindingStore";
import { readKeyingCanonicalJson } from "../../../utils/canonicalJson";
import { loadSignerPublicKey } from "../../signerPublicKey";
import {
  applyAttachmentContainerRekeys,
  assertAttachmentOrganizationCanSync,
  lockAttachmentAuthorizationForShare,
  readDetachRequestSession,
  verifyAttachmentAuthorizationProof,
} from "./authorization";
import { lockBlobMutationRows } from "./blobMutationLocks";
import { toMutationError } from "./errors";
import { finalizeAttachmentMutation } from "./finalizeAttachmentMutation";
import {
  appendAttachmentDetachAuditEvent,
  loadActiveAttachmentBindingById,
} from "./persistence";
import {
  BlobMutationError,
  type DetachBlobAttachmentInput,
  type DetachBlobAttachmentWorkflowResult,
} from "./types";

async function detachBlobAttachmentTransaction(
  input: DetachBlobAttachmentInput,
  tx: DatabaseTransaction,
): Promise<DetachBlobAttachmentWorkflowResult> {
  const { detachBody, event } = readDetachRequestSession(input);
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
  const signingPublicKey = await loadSignerPublicKey(tx, {
    ...input,
    error: (message, status) => new BlobMutationError(message, status),
  });
  const proof = await verifyAttachmentAuthorizationProof({
    bodyDocumentId: detachBody.documentId,
    executor: tx,
    request: input.request,
  });
  await assertAttachmentOrganizationCanSync(tx, proof, input.userId);
  await lockAttachmentAuthorizationForShare({
    documentId: detachBody.documentId,
    executor: tx,
    proof,
    request: input.request,
  });
  const verifiedDetach = await verifyAttachmentDetachEvent({
    authorizingContainerPaths: proof.authorizingContainerPaths,
    body: readKeyingCanonicalJson(
      input.request.body,
      "Blob attachment detach body",
    ),
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

  await lockBlobMutationRows({
    blobIds: [activeBinding.blobId],
    executor: tx,
  });
  const lockedActiveBinding = await loadActiveAttachmentBindingById({
    bindingId: input.bindingId,
    executor: tx,
  });
  if (!lockedActiveBinding) {
    throw new BlobMutationError("Attachment binding changed concurrently", 409);
  }

  await storeVerifiedAttachmentDetachInTransaction(verifiedDetach.value, tx);
  await appendAttachmentDetachAuditEvent({
    detach: verifiedDetach.value,
    executor: tx,
    fingerprint: input.fingerprint,
    manifest: proof.documentManifest,
    userId: input.userId,
  });
  await finalizeAttachmentMutation({
    dereferencedBlobId: verifiedDetach.value.blobId,
    documentId: verifiedDetach.value.documentId,
    executor: tx,
    linkedContainerIds: proof.documentManifest.state.linkedContainerIds,
  });

  return {
    linkedContainerIds: proof.documentManifest.state.linkedContainerIds,
    response: {
      bindingId: verifiedDetach.value.bindingId,
      blobId: verifiedDetach.value.blobId,
      documentId: verifiedDetach.value.documentId,
      slotId: verifiedDetach.value.slotId,
    },
  };
}

export async function runDetachBlobAttachmentWorkflow(
  db: ApiDatabase,
  input: DetachBlobAttachmentInput,
): Promise<DetachBlobAttachmentWorkflowResult> {
  try {
    return await db.transaction((tx) =>
      detachBlobAttachmentTransaction(input, tx),
    );
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
