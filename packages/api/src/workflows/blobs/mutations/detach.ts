import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  readKeyingCanonicalJson,
  verifyAttachmentDetachEvent,
} from "@tearleads/crypto";
import { storeVerifiedAttachmentDetachInTransaction } from "../../../access/write/attachmentBindingStore";
import type { DocumentVersionFrontier } from "../../../documents/documentUpdateStore";
import {
  containerPathsFromVerifiedPaths,
  resolveMissingContainerAncestorPaths,
} from "../../containers/containerAncestorPaths";
import { loadSignerPublicKey } from "../../signerPublicKey";
import {
  applyAttachmentContainerRekeys,
  assertAttachmentOrganizationCanSync,
  lockAttachmentAuthorizationForShare,
  readDetachRequestSession,
  verifyAttachmentAuthorizationProof,
} from "./authorization";
import { registerAttachmentBlobs } from "./blobAuditRegistry";
import { lockBlobMutationRows } from "./blobMutationLocks";
import {
  assertAttachmentDocumentVersionCurrent,
  assertBindVersionCommitted,
  parseAttachmentDocumentVersion,
} from "./documentVersionPrecondition";
import { toMutationError } from "./errors";
import { finalizeAttachmentMutation } from "./finalizeAttachmentMutation";
import { loadActiveAttachmentBindingById } from "./persistence";
import {
  BlobMutationError,
  type DetachBlobAttachmentInput,
  type DetachBlobAttachmentWorkflowResult,
} from "./types";

async function commitVerifiedAttachmentDetach(input: {
  readonly activeBinding: {
    readonly blobId: string;
    readonly id: string;
  };
  readonly executor: DatabaseTransaction;
  readonly proof: Awaited<
    ReturnType<typeof verifyAttachmentAuthorizationProof>
  >;
  readonly verifiedDetach: Extract<
    Awaited<ReturnType<typeof verifyAttachmentDetachEvent>>,
    { readonly ok: true }
  >["value"];
}): Promise<DetachBlobAttachmentWorkflowResult> {
  const { activeBinding, executor, proof, verifiedDetach } = input;
  await lockBlobMutationRows({
    blobIds: [activeBinding.blobId],
    executor,
  });
  const lockedActiveBinding = await loadActiveAttachmentBindingById({
    bindingId: activeBinding.id,
    executor,
  });
  if (!lockedActiveBinding) {
    throw new BlobMutationError("Attachment binding changed concurrently", 409);
  }

  await storeVerifiedAttachmentDetachInTransaction(verifiedDetach, executor);
  await registerAttachmentBlobs({
    blobIds: [verifiedDetach.blobId],
    executor,
    organizationId: proof.documentManifest.state.organizationId,
  });
  await finalizeAttachmentMutation({
    dereferencedBlobId: verifiedDetach.blobId,
    documentId: verifiedDetach.documentId,
    executor,
    linkedContainerIds: proof.documentManifest.state.linkedContainerIds,
    organizationId: proof.documentManifest.state.organizationId,
  });

  const containerPaths = await resolveMissingContainerAncestorPaths({
    containerIds: proof.documentManifest.state.linkedContainerIds,
    executor,
    knownPaths: containerPathsFromVerifiedPaths(
      proof.authorizingContainerPaths,
    ),
  });

  return {
    containerPaths,
    linkedContainerIds: proof.documentManifest.state.linkedContainerIds,
    response: {
      bindingId: verifiedDetach.bindingId,
      blobId: verifiedDetach.blobId,
      documentId: verifiedDetach.documentId,
      slotId: verifiedDetach.slotId,
    },
  };
}

async function detachBlobAttachmentTransaction(
  input: DetachBlobAttachmentInput & {
    readonly documentVersion: DocumentVersionFrontier;
  },
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
  // As a bind does, only once the signed detach is verified and under the
  // document head lock taken above: the client read the slot removed at this
  // version, which must hold every committed op, and every op the binding was
  // bound at must be committed, so a restore that is committed or still on
  // its way keeps it.
  await assertAttachmentDocumentVersionCurrent({
    documentId: activeBinding.documentId,
    executor: tx,
    processedThroughUpdateId: input.request.processedThroughUpdateId,
    version: input.documentVersion,
  });
  await assertBindVersionCommitted({
    bindVersion: { frontierJson: activeBinding.bindDocumentVersion },
    documentId: activeBinding.documentId,
    executor: tx,
  });

  return commitVerifiedAttachmentDetach({
    activeBinding,
    executor: tx,
    proof,
    verifiedDetach: verifiedDetach.value,
  });
}

export async function runDetachBlobAttachmentWorkflow(
  db: ApiDatabase,
  input: DetachBlobAttachmentInput,
): Promise<DetachBlobAttachmentWorkflowResult> {
  try {
    const documentVersion = parseAttachmentDocumentVersion(
      input.request.documentVersionVector,
    );
    return await db.transaction((tx) =>
      detachBlobAttachmentTransaction({ ...input, documentVersion }, tx),
    );
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
