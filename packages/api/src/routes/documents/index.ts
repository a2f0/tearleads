import { replaceBlobEnvelopeRecipients } from "@tearleads/crypto";
import { createLoroRouter } from "@tearleads/loro/server";
import {
  type CommitDocumentChangeRequest,
  isCommitDocumentChangeRequest,
  isStageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { validator } from "hono/validator";
import {
  blobRecipientEnvelopesMatchRecipients,
  canReadBlobAccess,
  listBlobRecipientEnvelopes,
  refreshBlobAccesses,
  replaceBlobRecipientEnvelopes,
  resolveBlobAccessState,
} from "../../access/blobAccess";
import {
  canWriteContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  canReadDocumentAccess,
  canWriteDocumentAccess,
  createDocumentRecipientEnvelopes,
  documentRecipientEnvelopesMatchRecipients,
  initializeDocumentAccess,
  listDocumentRecipientEnvelopes,
  listRecipientEncapsulationPublicKeys,
  listRecipientKeyFingerprints,
  replaceDocumentRecipientEnvelopes,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import { type DatabaseExecutor, db } from "../../adapters/postgres";
import { publish } from "../../adapters/redisPubSub";
import { requireAuth } from "../../middleware/session";
import {
  attachmentBindings,
  blobStages,
  blobs,
  containers,
  documentContainerLinks,
  documents,
  documentUpdates,
  objectAccessEpochs,
  objectRecipientEnvelopes,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";
import {
  listBlobRecipientKeyFingerprints,
  readLoroUpdateAccessEpoch,
} from "../../utils/recipientEnvelopes";

type DocumentRouteExecutor = DatabaseExecutor;
type CommitChangeAccess = NonNullable<
  Awaited<ReturnType<typeof resolveDocumentAccessState>>
>;

interface RouteSession {
  fingerprint: string;
  userId: string;
}

interface ActiveAttachmentBinding {
  blobId: string;
  id: string;
  slotId: string;
}

interface BlobStageRow {
  byteLength: number;
  encryptedBytes: string;
  expiresAt: Date;
  id: string;
  ownerUserId: string;
  sha256: string;
}

interface ValidatedAttachmentRewrap {
  currentBinding: ActiveAttachmentBinding;
  rewrap: CommitDocumentChangeRequest["attachmentRewraps"][number];
}

interface CommitChangeResult {
  acceptedOutgoingUpdateIds: string[];
  committedBindings: Array<{
    bindingId: string;
    blobId: string;
    slotId: string;
  }>;
  detachedBindingIds: string[];
  documentRecipientEnvelopes: CommitDocumentChangeRequest["documentRecipientEnvelopes"];
}

function matchesRecipientKeyFingerprints(
  actualRecipientKeyFingerprints: string[],
  expectedRecipientKeyFingerprints: string[],
): boolean {
  return (
    actualRecipientKeyFingerprints.length ===
      expectedRecipientKeyFingerprints.length &&
    actualRecipientKeyFingerprints.every(
      (fingerprint, index) =>
        fingerprint === expectedRecipientKeyFingerprints[index],
    )
  );
}

function hasDuplicateValues(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function deleteOrphanedBlobs(
  blobIds: string[],
  executor: DocumentRouteExecutor = db,
): Promise<string[]> {
  const uniqueBlobIds = uniqueSortedStrings(blobIds);

  if (uniqueBlobIds.length === 0) {
    return [];
  }

  const activeRows = await executor
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(
      and(
        inArray(attachmentBindings.blobId, uniqueBlobIds),
        isNull(attachmentBindings.detachedAt),
      ),
    );
  const activeBlobIds = uniqueSortedStrings(
    activeRows.map((row) => row.blobId),
  );
  const activeBlobIdSet = new Set(activeBlobIds);
  const orphanedBlobIds = uniqueBlobIds.filter(
    (blobId) => !activeBlobIdSet.has(blobId),
  );

  if (orphanedBlobIds.length === 0) {
    return activeBlobIds;
  }

  await executor
    .delete(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, "blob"),
        inArray(objectRecipientEnvelopes.objectId, orphanedBlobIds),
      ),
    );
  await executor
    .delete(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, "blob"),
        inArray(objectAccessEpochs.objectId, orphanedBlobIds),
      ),
    );
  await executor.delete(blobs).where(inArray(blobs.id, orphanedBlobIds));

  return activeBlobIds;
}

class CommitChangeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

class CreateDocumentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

class DocumentUpdateError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

async function ensureDocumentExists(documentId: string) {
  const document = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (document.length === 0) {
    throw new CommitChangeError("Document not found", 404);
  }
}

async function requireWritableCommitChangeAccess(
  documentId: string,
  userId: string,
): Promise<CommitChangeAccess> {
  const access = await resolveDocumentAccessState(documentId);
  if (!access) {
    throw new CommitChangeError("Document access state not found", 409);
  }
  if (!canWriteDocumentAccess(access, userId)) {
    throw new CommitChangeError("Forbidden", 403);
  }
  return access;
}

function validateCommitChangeInput(
  input: CommitDocumentChangeRequest,
  access: CommitChangeAccess,
  expectedRecipientKeyFingerprints: string[],
) {
  const touchedSlotIds = [
    ...input.attachmentCommits.map((commit) => commit.slotId),
    ...input.attachmentDetaches.map((detach) => detach.slotId),
    ...input.attachmentRewraps.map((rewrap) => rewrap.slotId),
  ];
  if (hasDuplicateValues(touchedSlotIds)) {
    throw new CommitChangeError("Duplicate slotId in attachment mutations");
  }

  const referencedSlotIds = input.loroUpdate?.referencedSlotIds ?? [];
  if (hasDuplicateValues(referencedSlotIds)) {
    throw new CommitChangeError("Duplicate slotId in loroUpdate references");
  }

  if (input.accessEpoch !== access.currentAccessEpoch) {
    throw new CommitChangeError("Stale access epoch", 409);
  }

  if (input.loroUpdate) {
    try {
      if (
        readLoroUpdateAccessEpoch(input.loroUpdate.encryptedData) !==
        input.accessEpoch
      ) {
        throw new CommitChangeError("Encrypted update access epoch mismatch");
      }
    } catch (error) {
      if (error instanceof CommitChangeError) {
        throw error;
      }
      throw new CommitChangeError("Invalid encrypted update envelope");
    }
  }

  if (
    input.documentRecipientEnvelopes &&
    !documentRecipientEnvelopesMatchRecipients(
      input.documentRecipientEnvelopes,
      access,
    )
  ) {
    throw new CommitChangeError("Document recipient envelopes mismatch");
  }

  return {
    referencedSlotIds,
    touchedSlotIds,
    expectedRecipientKeyFingerprints,
  };
}

async function loadActiveAttachmentBindings(
  tx: DocumentRouteExecutor,
  documentId: string,
  slotIds: string[],
): Promise<Map<string, ActiveAttachmentBinding>> {
  if (slotIds.length === 0) {
    return new Map();
  }

  const activeBindings = await tx
    .select({
      id: attachmentBindings.id,
      slotId: attachmentBindings.slotId,
      blobId: attachmentBindings.blobId,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, documentId),
        inArray(attachmentBindings.slotId, slotIds),
        isNull(attachmentBindings.detachedAt),
      ),
    );

  return new Map(activeBindings.map((binding) => [binding.slotId, binding]));
}

function validateAttachmentDetaches(
  detaches: CommitDocumentChangeRequest["attachmentDetaches"],
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>,
) {
  for (const detach of detaches) {
    const currentBinding = activeBindingBySlotId.get(detach.slotId);
    if (!currentBinding || currentBinding.id !== detach.expectedBindingId) {
      throw new CommitChangeError(
        `Attachment slot ${detach.slotId} is not bound to the expected binding`,
      );
    }
  }
}

function validateAttachmentRewraps(
  rewraps: CommitDocumentChangeRequest["attachmentRewraps"],
  access: CommitChangeAccess,
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>,
): ValidatedAttachmentRewrap[] {
  const validatedRewraps: ValidatedAttachmentRewrap[] = [];

  for (const rewrap of rewraps) {
    const currentBinding = activeBindingBySlotId.get(rewrap.slotId);
    if (!currentBinding || currentBinding.id !== rewrap.expectedBindingId) {
      throw new CommitChangeError(
        `Attachment slot ${rewrap.slotId} is not bound to the expected binding`,
      );
    }
    if (
      !blobRecipientEnvelopesMatchRecipients(
        rewrap.recipientEnvelopes,
        access.effectiveRecipients,
      )
    ) {
      throw new CommitChangeError("Blob recipient envelopes mismatch");
    }

    validatedRewraps.push({ rewrap, currentBinding });
  }

  return validatedRewraps;
}

async function loadBlobStagesById(
  tx: DocumentRouteExecutor,
  commits: CommitDocumentChangeRequest["attachmentCommits"],
) {
  if (commits.length === 0) {
    return new Map<string, BlobStageRow>();
  }

  const stageRows = await tx
    .select({
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
      encryptedBytes: blobStages.encryptedBytes,
      sha256: blobStages.sha256,
      byteLength: blobStages.byteLength,
      expiresAt: blobStages.expiresAt,
    })
    .from(blobStages)
    .where(
      inArray(
        blobStages.id,
        commits.map((commit) => commit.stageId),
      ),
    );

  return new Map(stageRows.map((stage) => [stage.id, stage]));
}

function validateAttachmentCommits(
  commits: CommitDocumentChangeRequest["attachmentCommits"],
  stageById: Map<string, BlobStageRow>,
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>,
  expectedRecipientKeyFingerprints: string[],
  session: RouteSession,
) {
  for (const commit of commits) {
    const stage = stageById.get(commit.stageId);
    if (!stage) {
      throw new CommitChangeError(
        `Blob stage ${commit.stageId} does not exist`,
      );
    }
    if (stage.ownerUserId !== session.userId) {
      throw new CommitChangeError(
        `Blob stage ${commit.stageId} does not belong to caller`,
        403,
      );
    }
    if (stage.expiresAt.getTime() <= Date.now()) {
      throw new CommitChangeError(`Blob stage ${commit.stageId} has expired`);
    }
    if (
      (activeBindingBySlotId.get(commit.slotId)?.id ?? null) !==
      commit.expectedBindingId
    ) {
      throw new CommitChangeError(
        `Attachment slot ${commit.slotId} is not bound to the expected binding`,
      );
    }

    try {
      if (
        !matchesRecipientKeyFingerprints(
          listBlobRecipientKeyFingerprints(stage.encryptedBytes),
          expectedRecipientKeyFingerprints,
        )
      ) {
        throw new CommitChangeError("Encrypted blob recipients mismatch");
      }
    } catch (error) {
      if (error instanceof CommitChangeError) {
        throw error;
      }
      throw new CommitChangeError("Invalid encrypted blob envelope");
    }
  }
}

async function applyAttachmentDetaches(
  tx: DocumentRouteExecutor,
  detaches: CommitDocumentChangeRequest["attachmentDetaches"],
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>,
  affectedBlobIds: Set<string>,
) {
  const detachedBindingIds: string[] = [];

  for (const detach of detaches) {
    const currentBinding = activeBindingBySlotId.get(detach.slotId);
    if (!currentBinding) {
      continue;
    }

    await tx
      .update(attachmentBindings)
      .set({ detachedAt: new Date() })
      .where(eq(attachmentBindings.id, currentBinding.id));

    detachedBindingIds.push(currentBinding.id);
    affectedBlobIds.add(currentBinding.blobId);
    activeBindingBySlotId.delete(detach.slotId);
  }

  return detachedBindingIds;
}

async function applyAttachmentCommits(
  tx: DocumentRouteExecutor,
  documentId: string,
  commits: CommitDocumentChangeRequest["attachmentCommits"],
  stageById: Map<string, BlobStageRow>,
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>,
  affectedBlobIds: Set<string>,
) {
  const committedBindings: CommitChangeResult["committedBindings"] = [];
  const detachedBindingIds: string[] = [];

  for (const commit of commits) {
    const stage = stageById.get(commit.stageId);
    if (!stage) {
      throw new CommitChangeError(
        `Blob stage ${commit.stageId} does not exist`,
      );
    }

    const currentBinding = activeBindingBySlotId.get(commit.slotId) ?? null;
    if (currentBinding) {
      await tx
        .update(attachmentBindings)
        .set({ detachedAt: new Date() })
        .where(eq(attachmentBindings.id, currentBinding.id));
      detachedBindingIds.push(currentBinding.id);
      affectedBlobIds.add(currentBinding.blobId);
    }

    const [blob] = await tx
      .insert(blobs)
      .values({
        byteLength: stage.byteLength,
        encryptedBytes: stage.encryptedBytes,
        sha256: stage.sha256,
        storageKey: stage.id,
      })
      .returning({ id: blobs.id });
    if (!blob) {
      throw new Error(`Failed to promote blob stage ${stage.id}`);
    }

    const [binding] = await tx
      .insert(attachmentBindings)
      .values({
        documentId,
        slotId: commit.slotId,
        blobId: blob.id,
        previousBindingId: currentBinding?.id ?? null,
      })
      .returning({ id: attachmentBindings.id });
    if (!binding) {
      throw new Error(
        `Failed to create attachment binding for ${commit.slotId}`,
      );
    }

    committedBindings.push({
      slotId: commit.slotId,
      bindingId: binding.id,
      blobId: blob.id,
    });
    affectedBlobIds.add(blob.id);
    activeBindingBySlotId.set(commit.slotId, {
      id: binding.id,
      slotId: commit.slotId,
      blobId: blob.id,
    });
    await tx.delete(blobStages).where(eq(blobStages.id, stage.id));
  }

  return { committedBindings, detachedBindingIds };
}

function validateReferencedSlots(
  referencedSlotIds: string[],
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>,
) {
  for (const slotId of referencedSlotIds) {
    if (!activeBindingBySlotId.has(slotId)) {
      throw new CommitChangeError(
        `Loro update references slot ${slotId} without an active binding`,
      );
    }
  }
}

async function commitDocumentLoroUpdate(
  tx: DocumentRouteExecutor,
  input: CommitDocumentChangeRequest,
  documentId: string,
  access: CommitChangeAccess,
  session: RouteSession,
) {
  const acceptedOutgoingUpdateIds: string[] = [];
  let currentDocumentRecipientEnvelopes = await listDocumentRecipientEnvelopes(
    documentId,
    access.currentAccessEpoch,
    tx,
  );

  if (!input.loroUpdate) {
    return { acceptedOutgoingUpdateIds, currentDocumentRecipientEnvelopes };
  }

  if (input.documentRecipientEnvelopes) {
    await replaceDocumentRecipientEnvelopes(
      documentId,
      access.currentAccessEpoch,
      access,
      input.documentRecipientEnvelopes,
      tx,
    );
    currentDocumentRecipientEnvelopes = input.documentRecipientEnvelopes;
  }

  if (
    !currentDocumentRecipientEnvelopes ||
    currentDocumentRecipientEnvelopes.length === 0
  ) {
    throw new CommitChangeError(
      "Missing document recipient envelopes for current epoch",
    );
  }

  const [existing] = await tx
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.id, input.loroUpdate.id))
    .limit(1);
  if (existing) {
    acceptedOutgoingUpdateIds.push(existing.id);
    return { acceptedOutgoingUpdateIds, currentDocumentRecipientEnvelopes };
  }

  const [inserted] = await tx
    .insert(documentUpdates)
    .values({
      id: input.loroUpdate.id,
      documentId,
      authorFingerprint: session.fingerprint,
      encryptedData: input.loroUpdate.encryptedData,
      partialStartVersionVector: input.loroUpdate.partialStartVersionVector,
      partialEndVersionVector: input.loroUpdate.partialEndVersionVector,
    })
    .returning({ id: documentUpdates.id });
  if (inserted) {
    acceptedOutgoingUpdateIds.push(inserted.id);
  }

  return { acceptedOutgoingUpdateIds, currentDocumentRecipientEnvelopes };
}

async function applyAttachmentRewraps(
  tx: DocumentRouteExecutor,
  validatedRewraps: ValidatedAttachmentRewrap[],
) {
  for (const { rewrap, currentBinding } of validatedRewraps) {
    const blobAccess = await resolveBlobAccessState(currentBinding.blobId, tx);
    if (!blobAccess) {
      throw new CommitChangeError("Blob access state not found", 409);
    }

    await replaceBlobRecipientEnvelopes(
      currentBinding.blobId,
      blobAccess.currentAccessEpoch,
      blobAccess.effectiveRecipients,
      rewrap.recipientEnvelopes,
      tx,
    );
  }
}

async function runCommitChangeTransaction(input: {
  input: CommitDocumentChangeRequest;
  access: CommitChangeAccess;
  documentId: string;
  expectedRecipientKeyFingerprints: string[];
  referencedSlotIds: string[];
  session: RouteSession;
  touchedSlotIds: string[];
}) {
  return db.transaction(async (tx) => {
    const activeBindingSlotIds = uniqueSortedStrings([
      ...input.touchedSlotIds,
      ...input.referencedSlotIds,
    ]);
    const activeBindingBySlotId = await loadActiveAttachmentBindings(
      tx,
      input.documentId,
      activeBindingSlotIds,
    );

    validateAttachmentDetaches(
      input.input.attachmentDetaches,
      activeBindingBySlotId,
    );
    const validatedRewraps = validateAttachmentRewraps(
      input.input.attachmentRewraps,
      input.access,
      activeBindingBySlotId,
    );
    const stageById = await loadBlobStagesById(
      tx,
      input.input.attachmentCommits,
    );
    validateAttachmentCommits(
      input.input.attachmentCommits,
      stageById,
      activeBindingBySlotId,
      input.expectedRecipientKeyFingerprints,
      input.session,
    );

    const affectedBlobIds = new Set<string>();
    const detachedBindingIds = await applyAttachmentDetaches(
      tx,
      input.input.attachmentDetaches,
      activeBindingBySlotId,
      affectedBlobIds,
    );
    for (const { currentBinding } of validatedRewraps) {
      affectedBlobIds.add(currentBinding.blobId);
    }

    const committed = await applyAttachmentCommits(
      tx,
      input.documentId,
      input.input.attachmentCommits,
      stageById,
      activeBindingBySlotId,
      affectedBlobIds,
    );
    validateReferencedSlots(input.referencedSlotIds, activeBindingBySlotId);
    const loroUpdateResult = await commitDocumentLoroUpdate(
      tx,
      input.input,
      input.documentId,
      input.access,
      input.session,
    );

    const activeBlobIds = await deleteOrphanedBlobs(
      Array.from(affectedBlobIds),
      tx,
    );
    await refreshBlobAccesses(activeBlobIds, tx);
    await applyAttachmentRewraps(tx, validatedRewraps);

    return {
      acceptedOutgoingUpdateIds: loroUpdateResult.acceptedOutgoingUpdateIds,
      committedBindings: committed.committedBindings,
      detachedBindingIds: [
        ...detachedBindingIds,
        ...committed.detachedBindingIds,
      ],
      documentRecipientEnvelopes:
        loroUpdateResult.currentDocumentRecipientEnvelopes,
    };
  });
}

async function processCommitDocumentChange(input: {
  documentId: string;
  request: CommitDocumentChangeRequest;
  session: RouteSession;
}) {
  await ensureDocumentExists(input.documentId);
  const access = await requireWritableCommitChangeAccess(
    input.documentId,
    input.session.userId,
  );
  const expectedRecipientKeyFingerprints = uniqueSortedStrings(
    listRecipientKeyFingerprints(access),
  );
  const validatedInput = validateCommitChangeInput(
    input.request,
    access,
    expectedRecipientKeyFingerprints,
  );
  const result = await runCommitChangeTransaction({
    input: input.request,
    access,
    documentId: input.documentId,
    expectedRecipientKeyFingerprints,
    referencedSlotIds: validatedInput.referencedSlotIds,
    session: input.session,
    touchedSlotIds: validatedInput.touchedSlotIds,
  });

  return { access, result };
}

export const documentsRouter = createLoroRouter({
  store: {
    async createDocument(input) {
      const linkedContainerIds = uniqueSortedStrings(input.linkedContainerIds);

      if (input.linkedContainerIds.length !== linkedContainerIds.length) {
        throw new CreateDocumentError(
          "linkedContainerIds must not contain duplicates",
          400,
        );
      }

      return db.transaction(async (tx) => {
        const linkedContainers = await tx
          .select({
            id: containers.id,
            organizationId: containers.organizationId,
          })
          .from(containers)
          .where(inArray(containers.id, linkedContainerIds));

        if (linkedContainers.length !== linkedContainerIds.length) {
          throw new CreateDocumentError("Linked container not found", 404);
        }

        const organizationIds = uniqueSortedStrings(
          linkedContainers.map((container) => container.organizationId),
        );

        if (organizationIds.length !== 1) {
          throw new CreateDocumentError(
            "All linked containers must belong to the same organization",
            400,
          );
        }

        for (const container of linkedContainers) {
          const access = await resolveContainerAccessState(container.id, tx);

          if (!access) {
            throw new CreateDocumentError(
              "Linked container access state is unavailable",
              409,
            );
          }

          if (!canWriteContainerAccess(access, input.createdByUserId)) {
            throw new CreateDocumentError("Forbidden", 403);
          }
        }

        const [document] = await tx
          .insert(documents)
          .values({
            createdByFingerprint: input.createdByFingerprint,
          })
          .returning();
        if (!document) {
          return null;
        }

        await tx.insert(documentContainerLinks).values(
          linkedContainerIds.map((containerId) => ({
            documentId: document.id,
            containerId,
          })),
        );

        const currentAccessEpoch = await initializeDocumentAccess(
          document.id,
          tx,
        );
        const access = await resolveDocumentAccessState(document.id, tx);
        if (!access) {
          return null;
        }

        const initialDocumentRecipientEnvelopes =
          await createDocumentRecipientEnvelopes(access);
        if (initialDocumentRecipientEnvelopes) {
          await replaceDocumentRecipientEnvelopes(
            document.id,
            currentAccessEpoch,
            access,
            initialDocumentRecipientEnvelopes,
            tx,
          );
        }

        return {
          document,
          currentAccessEpoch,
          documentRecipientEnvelopes: initialDocumentRecipientEnvelopes,
          recipientEncapsulationPublicKeys:
            listRecipientEncapsulationPublicKeys(access),
          referencedPrincipals: access.referencedPrincipals,
        };
      });
    },
    async getDocumentById(documentId) {
      const [document] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId));
      return document ?? null;
    },
    async getDocumentAccess({ documentId, userId }) {
      const access = await resolveDocumentAccessState(documentId);
      if (!access) {
        return null;
      }

      return {
        canRead: canReadDocumentAccess(access, userId),
        canWrite: canWriteDocumentAccess(access, userId),
        currentAccessEpoch: access.currentAccessEpoch,
        documentRecipientEnvelopes: await listDocumentRecipientEnvelopes(
          documentId,
          access.currentAccessEpoch,
        ),
        recipientKeyFingerprints: listRecipientKeyFingerprints(access),
        recipientEncapsulationPublicKeys:
          listRecipientEncapsulationPublicKeys(access),
        referencedPrincipals: access.referencedPrincipals,
      };
    },
    async appendDocumentUpdates({
      documentId,
      authorFingerprint,
      documentRecipientEnvelopes,
      updates,
    }) {
      const access = await resolveDocumentAccessState(documentId);
      if (!access) {
        throw new DocumentUpdateError("Document access state not found", 409);
      }

      const existingEnvelopes = await listDocumentRecipientEnvelopes(
        documentId,
        access.currentAccessEpoch,
      );
      const nextEnvelopes = documentRecipientEnvelopes ?? existingEnvelopes;

      if (!nextEnvelopes || nextEnvelopes.length === 0) {
        throw new DocumentUpdateError(
          "Missing document recipient envelopes for current epoch",
          400,
        );
      }

      if (
        documentRecipientEnvelopes &&
        !documentRecipientEnvelopesMatchRecipients(
          documentRecipientEnvelopes,
          access,
        )
      ) {
        throw new DocumentUpdateError(
          "Document recipient envelopes mismatch",
          400,
        );
      }

      if (documentRecipientEnvelopes) {
        await replaceDocumentRecipientEnvelopes(
          documentId,
          access.currentAccessEpoch,
          access,
          documentRecipientEnvelopes,
        );
      }

      const acceptedUpdateIds: string[] = [];

      for (const update of updates) {
        const [existing] = await db
          .select({ id: documentUpdates.id })
          .from(documentUpdates)
          .where(eq(documentUpdates.id, update.id))
          .limit(1);

        if (existing) {
          acceptedUpdateIds.push(existing.id);
          continue;
        }

        const [inserted] = await db
          .insert(documentUpdates)
          .values({
            id: update.id,
            documentId,
            authorFingerprint,
            encryptedData: update.encryptedData,
            partialStartVersionVector: update.partialStartVersionVector,
            partialEndVersionVector: update.partialEndVersionVector,
          })
          .returning({ id: documentUpdates.id });

        if (inserted) {
          acceptedUpdateIds.push(inserted.id);
        }
      }

      return acceptedUpdateIds;
    },
    async listDocumentUpdates(documentId) {
      return db
        .select()
        .from(documentUpdates)
        .where(eq(documentUpdates.documentId, documentId))
        .orderBy(documentUpdates.sequence);
    },
  },
  publish,
  requireAuth,
});

documentsRouter.post(
  "/blobs/stage",
  requireAuth,
  validator("json", (value, c) => {
    if (!isStageBlobRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const session = c.get("session");
    const { encryptedBytes, byteLength, sha256 } = c.req.valid("json");
    const encodedBytes = new TextEncoder().encode(encryptedBytes);

    if (encodedBytes.byteLength !== byteLength) {
      return c.json(
        { error: "Blob byteLength does not match encryptedBytes" },
        400,
      );
    }

    if ((await sha256Hex(encryptedBytes)) !== sha256) {
      return c.json(
        { error: "Blob sha256 does not match encryptedBytes" },
        400,
      );
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const [stage] = await db
      .insert(blobStages)
      .values({
        ownerUserId: session.userId,
        encryptedBytes,
        byteLength,
        sha256,
        expiresAt,
      })
      .returning({ id: blobStages.id, expiresAt: blobStages.expiresAt });

    if (!stage) {
      return c.json({ error: "Failed to stage blob" }, 500);
    }

    return c.json({
      stageId: stage.id,
      expiresAt: stage.expiresAt.toISOString(),
    });
  },
);

documentsRouter.post(
  "/documents/:documentId/commit-change",
  requireAuth,
  validator("json", (value, c) => {
    if (!isCommitDocumentChangeRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const documentId = c.req.param("documentId");
    const session = c.get("session");
    const request = c.req.valid("json");

    try {
      const { access, result } = await processCommitDocumentChange({
        documentId,
        request,
        session,
      });

      if (result.acceptedOutgoingUpdateIds.length > 0) {
        await publish({
          type: "document_update_created",
          documentId,
          updateIds: result.acceptedOutgoingUpdateIds,
        });
      }

      return c.json({
        currentAccessEpoch: access.currentAccessEpoch,
        acceptedOutgoingUpdateIds: result.acceptedOutgoingUpdateIds,
        committedBindings: result.committedBindings,
        detachedBindingIds: result.detachedBindingIds,
        documentRecipientEnvelopes: result.documentRecipientEnvelopes,
      });
    } catch (error) {
      if (error instanceof CommitChangeError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  },
);

documentsRouter.get(
  "/documents/:documentId/attachments",
  requireAuth,
  async (c) => {
    const documentId = c.req.param("documentId");
    const session = c.get("session");

    const access = await resolveDocumentAccessState(documentId);
    if (!access) {
      return c.json({ error: "Document not found" }, 404);
    }

    if (!canReadDocumentAccess(access, session.userId)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const rows = await db
      .select({
        bindingId: attachmentBindings.id,
        blobId: attachmentBindings.blobId,
        slotId: attachmentBindings.slotId,
      })
      .from(attachmentBindings)
      .where(
        and(
          eq(attachmentBindings.documentId, documentId),
          isNull(attachmentBindings.detachedAt),
        ),
      );

    return c.json<ListDocumentAttachmentsResponse>(
      rows.map((row) => ({
        bindingId: row.bindingId,
        blobId: row.blobId,
        slotId: row.slotId,
      })),
    );
  },
);

documentsRouter.get("/blobs/:blobId", requireAuth, async (c) => {
  const blobId = c.req.param("blobId");
  const session = c.get("session");

  const access = await resolveBlobAccessState(blobId);
  if (!access) {
    return c.json({ error: "Blob not found" }, 404);
  }

  if (!canReadBlobAccess(access, session.userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [row] = await db
    .select({
      blobId: blobs.id,
      encryptedBytes: blobs.encryptedBytes,
      sha256: blobs.sha256,
    })
    .from(blobs)
    .where(eq(blobs.id, blobId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Blob not found" }, 404);
  }

  const currentRecipientEnvelopes = await listBlobRecipientEnvelopes(
    blobId,
    access.currentAccessEpoch,
  );
  const encryptedBytes = currentRecipientEnvelopes
    ? replaceBlobEnvelopeRecipients(
        row.encryptedBytes,
        currentRecipientEnvelopes,
      )
    : row.encryptedBytes;

  return c.json<BlobResponse>({
    blobId: row.blobId,
    encryptedBytes,
    sha256:
      encryptedBytes === row.encryptedBytes
        ? row.sha256
        : await sha256Hex(encryptedBytes),
  });
});
