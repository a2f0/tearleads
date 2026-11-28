import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  blobContentMetadataHash,
  readKeyingCanonicalJson,
  verifyAttachmentBindingEvent,
  verifyWriteHeader,
} from "@tearleads/crypto";
import type { BlobAttachmentBindResponse } from "@tearleads/validators/response";
import { listBlobContentWriteHeaders } from "../../../access/read/blobContentKeyStore";
import { storeVerifiedAttachmentBindingInTransaction } from "../../../access/write/attachmentBindingStore";
import {
  storeBlobContentKeyBundleInTransaction,
  storeBlobContentWriteHeader,
} from "../../../access/write/blobContentKeyStore";
import { readCommitCheckpoint } from "../../../documents/commitLsn";
import type { DocumentVersionFrontier } from "../../../documents/documentUpdateStore";
import { appendAttachmentBindDocumentSync } from "../../documents/mutations";
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
import { registerAttachmentBlobs } from "./blobAuditRegistry";
import { lockBlobMutationRows } from "./blobMutationLocks";
import {
  assertAttachmentDocumentVersionCurrent,
  parseAttachmentDocumentVersion,
} from "./documentVersionPrecondition";
import { toMutationError } from "./errors";
import { assertExistingBlobSourceAuthority } from "./existingBlobAuthority";
import { finalizeAttachmentMutation } from "./finalizeAttachmentMutation";
import {
  detachActiveSlotBinding,
  promoteStagedBlobIfPresent,
  requireSingleActiveAttachmentBindingForSlot,
  reviveBlobIfDereferenced,
} from "./persistence";
import {
  type ResolvedBlobKekTargets,
  readWriteHeader,
  toBindResponse,
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
  readonly stagedBlob: Pick<
    PrevalidatedMultipartBlobStage,
    "sha256" | "envelopeHeader"
  > | null;
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

  const envelope = input.stagedBlob.envelopeHeader;
  if (
    envelope.blobId !== header.objectId ||
    envelope.contentKeyEpoch !== header.contentKeyEpoch ||
    envelope.contentRecordId !== header.contentRecordId ||
    envelope.metadataHash !== header.metadataHash ||
    envelope.nonceDomainHash !== header.nonceDomainHash
  ) {
    throw new BlobMutationError(
      "Blob encrypted envelope does not match its signed write header",
      400,
    );
  }

  if (envelope.metadataHash !== (await blobContentMetadataHash(envelope))) {
    throw new BlobMutationError(
      "Blob encrypted envelope metadata hash is invalid",
      400,
    );
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
  if (!input.request.stagedBlob) {
    await assertExistingBlobSourceAuthority({
      blobId: input.blobId,
      executor: input.tx,
      userId: input.event.signerUserId,
    });
  }
  return { activeBinding, verifiedBinding };
}

async function verifyAndLockBindAuthorization(
  input: BindBlobAttachmentInput,
  documentId: string,
  tx: DatabaseTransaction,
) {
  // These queries share one transaction connection, so run sequentially.
  const signingPublicKey = await loadSignerPublicKey(tx, {
    ...input,
    error: (message, status) => new BlobMutationError(message, status),
  });
  const proof = await verifyAttachmentAuthorizationProof({
    bodyDocumentId: documentId,
    executor: tx,
    request: input.request,
  });
  await assertAttachmentOrganizationCanSync(tx, proof, input.userId);
  const lockedContainerHeads = await lockAttachmentAuthorizationForShare({
    blobId: input.blobId,
    contentKeyTargets: input.request.contentKeyBundle.targets,
    documentId,
    documentSync: input.request.documentSync,
    executor: tx,
    proof,
    request: input.request,
  });
  return { lockedContainerHeads, proof, signingPublicKey };
}

function storeBindingKeys(
  input: BindBlobAttachmentInput,
  binding: Parameters<typeof toStoredContentKeyBundleInput>[0],
  tx: DatabaseTransaction,
) {
  return storeBlobContentKeyBundleInTransaction(
    toStoredContentKeyBundleInput(binding, input.request.contentKeyBundle),
    tx,
  );
}

interface BindTransactionResult {
  readonly acceptedOutgoingUpdateIds: readonly string[] | null;
  readonly containerPaths: Readonly<Record<string, readonly string[]>>;
  readonly linkedContainerIds: readonly string[];
  readonly response: BlobAttachmentBindResponse;
}

export interface BindBlobAttachmentWorkflowResult {
  readonly containerPaths: Readonly<Record<string, readonly string[]>>;
  readonly linkedContainerIds: readonly string[];
  readonly response: BlobAttachmentBindResponse;
}

/**
 * Commits any carried document sync after the binding row (so no reader sees
 * content naming an unbound attachment), then runs `finalizeAttachmentMutation`
 * after all projection locks while skipping duplicate document/container
 * touches when the carried sync inserted updates.
 */
async function appendCarriedSyncAndFinalizeBind(input: {
  readonly activeBinding: Awaited<
    ReturnType<typeof requireSingleActiveAttachmentBindingForSlot>
  >;
  readonly bindInput: BindBlobAttachmentInput;
  readonly documentId: string;
  readonly lockedContainerHeads: Awaited<
    ReturnType<typeof lockAttachmentAuthorizationForShare>
  >;
  readonly proof: AttachmentAuthorizationProof;
  readonly signingPublicKey: Uint8Array;
  readonly tx: DatabaseTransaction;
}): Promise<readonly string[] | null> {
  const { documentId, organizationId } = input.proof.documentManifest.state;
  const carriedSync = input.bindInput.request.documentSync
    ? await appendAttachmentBindDocumentSync({
        documentId,
        executor: input.tx,
        fingerprint: input.bindInput.fingerprint,
        lockedContainerHeads: input.lockedContainerHeads,
        request: input.bindInput.request.documentSync,
        signingPublicKey: input.signingPublicKey,
        syncEligibleOrganizationId: organizationId,
        userId: input.bindInput.userId,
      })
    : null;
  await finalizeAttachmentMutation({
    ...(input.activeBinding
      ? { dereferencedBlobId: input.activeBinding.blobId }
      : {}),
    documentId: input.documentId,
    executor: input.tx,
    linkedContainerIds: input.proof.documentManifest.state.linkedContainerIds,
    organizationId,
    skipTargetsTouch: (carriedSync?.insertedUpdateIds.length ?? 0) > 0,
  });
  return carriedSync?.acceptedOutgoingUpdateIds ?? null;
}

async function bindBlobAttachmentTransaction(
  input: BindBlobAttachmentInput & {
    readonly documentVersion: DocumentVersionFrontier;
    readonly prevalidatedMultipartStage: PrevalidatedMultipartBlobStage | null;
  },
  tx: DatabaseTransaction,
): Promise<BindTransactionResult> {
  const { bindBody, event } = readBindRequestSession(input);
  await applyAttachmentContainerRekeys({
    executor: tx,
    fingerprint: input.fingerprint,
    request: input.request,
    userId: input.userId,
  });
  const { lockedContainerHeads, proof, signingPublicKey } =
    await verifyAndLockBindAuthorization(input, bindBody.documentId, tx);
  const { activeBinding, verifiedBinding } = await verifyAndLockBindSlot({
    bindBody,
    blobId: input.blobId,
    event,
    proof,
    request: input.request,
    signingPublicKey,
    tx,
  });
  // Only once the signed bind is verified, so a caller without write access
  // learns nothing about the document's updates; still under the document
  // head lock taken above, so no update commits after it.
  await assertAttachmentDocumentVersionCurrent({
    documentId: bindBody.documentId,
    executor: tx,
    processedThroughUpdateId: input.request.processedThroughUpdateId,
    version: input.documentVersion,
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
  await storeVerifiedAttachmentBindingInTransaction(verifiedBinding, tx, {
    bindDocumentVersion: input.documentVersion.frontierJson,
  });
  // The blob now has an active binding again; clear any prior purge soft-delete
  // so the GC sweep does not reclaim a blob this bind just re-referenced.
  await reviveBlobIfDereferenced({ blobId: input.blobId, executor: tx });
  const contentKeyBundle = await storeBindingKeys(input, verifiedBinding, tx);
  const { currentTargets } = contentKeyBundle;
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
  await registerAttachmentBlobs({
    blobIds: [verifiedBinding.blobId, activeBinding?.blobId ?? null],
    executor: tx,
    organizationId: proof.documentManifest.state.organizationId,
  });
  const acceptedOutgoingUpdateIds = await appendCarriedSyncAndFinalizeBind({
    activeBinding,
    bindInput: input,
    documentId: verifiedBinding.documentId,
    lockedContainerHeads,
    proof,
    signingPublicKey,
    tx,
  });
  return {
    acceptedOutgoingUpdateIds,
    containerPaths: currentTargets.containerPaths,
    linkedContainerIds: currentTargets.targets.map((t) => t.containerId),
    response: toBindResponse({
      binding: verifiedBinding,
      blobId: input.blobId,
      contentKeyBundle,
      currentTargets,
      writeHeaderHash: writeHeaderHash ?? storedWriteHeader.headerHash,
    }),
  };
}

export async function runBindBlobAttachmentWorkflow(
  db: ApiDatabase,
  input: BindBlobAttachmentInput & {
    readonly prevalidatedMultipartStage?: PrevalidatedMultipartBlobStage | null;
  },
): Promise<BindBlobAttachmentWorkflowResult> {
  try {
    const documentVersion = parseAttachmentDocumentVersion(
      input.request.documentVersionVector,
    );
    const {
      acceptedOutgoingUpdateIds,
      containerPaths,
      linkedContainerIds,
      response,
    } = await db.transaction((tx) =>
      bindBlobAttachmentTransaction(
        {
          ...input,
          documentVersion,
          prevalidatedMultipartStage: input.prevalidatedMultipartStage ?? null,
        },
        tx,
      ),
    );
    if (acceptedOutgoingUpdateIds === null) {
      return { containerPaths, linkedContainerIds, response };
    }
    return {
      containerPaths,
      linkedContainerIds,
      response: {
        ...response,
        documentSync: {
          acceptedOutgoingUpdateIds: [...acceptedOutgoingUpdateIds],
          ...(await readCommitCheckpoint(db)),
        },
      },
    };
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) throw mutationError;
    throw error;
  }
}
