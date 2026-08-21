import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import { verifyAttachmentDetachEvent } from "@symcrypt/crypto";
import { storeVerifiedAttachmentDetachInTransaction } from "../../../access/write/attachmentBindingStore";
import { readKeyingCanonicalJson } from "../../../utils/canonicalJson";
import { touchDocumentAndLinkedContainers } from "../../documents/mutations/shared/documentRows";
import { loadSignerPublicKey } from "../../signerPublicKey";
import {
  applyAttachmentContainerRekeys,
  assertAttachmentOrganizationCanSync,
  readDetachRequestSession,
  verifyAttachmentAuthorizationProof,
} from "./authorization";
import { toMutationError } from "./errors";
import {
  appendAttachmentDetachAuditEvent,
  loadActiveAttachmentBindingById,
} from "./persistence";
import {
  BlobMutationError,
  type DetachBlobAttachmentInput,
  type DetachBlobAttachmentWorkflowResult,
} from "./types";

export async function runDetachBlobAttachmentWorkflow(
  db: ApiDatabase,
  input: DetachBlobAttachmentInput,
): Promise<DetachBlobAttachmentWorkflowResult> {
  try {
    return await db.transaction(async (tx) => {
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
      // Run sequentially: both queries share the single transaction
      // connection, so issuing them concurrently only trips pg's
      // already-executing-query deprecation without any real parallelism.
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
      await touchDocumentAndLinkedContainers(tx, {
        documentId: verifiedDetach.value.documentId,
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
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
