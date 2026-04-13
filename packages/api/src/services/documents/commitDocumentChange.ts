import type { CommitDocumentChangeRequest } from "@tearleads/validators/request";
import type { CommitDocumentChangeResponse } from "@tearleads/validators/response";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  blobRecipientEnvelopesMatchRecipients,
  getBlobRecipientEnvelopeAction,
  refreshBlobAccesses,
  replaceBlobRecipientEnvelopes,
  resolveBlobAccessState,
} from "../../access/blobAccess";
import {
  canWriteDocumentAccess,
  DocumentRecipientEnvelopeConflictError,
  documentRecipientEnvelopesMatchRecipients,
  getDocumentRecipientEnvelopeAction,
  listDocumentRecipientEnvelopes,
  listRecipientKeyFingerprints,
  putDocumentRecipientEnvelopes,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  attachmentBindings,
  blobStages,
  blobs,
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
import type { ApiServiceRuntime } from "../runtime";
import {
  getDocumentCheckpointInputError,
  maybeWriteDocumentAuditCheckpoint,
} from "./documentAuditCheckpoints";
import { getRotateBaselineSourceError } from "./documentSyncStore";
import { insertDocumentUpdateSpans } from "./documentUpdateSpans";

type CommitChangeExecutor = DatabaseExecutor;
type CommitChangeAccess = NonNullable<
  Awaited<ReturnType<typeof resolveDocumentAccessState>>
>;

interface CommitDocumentChangeSession {
  fingerprint: string;
  userId: string;
}

interface CommitDocumentChangeInput {
  documentId: string;
  request: CommitDocumentChangeRequest;
  session: CommitDocumentChangeSession;
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

type CommitChangeTransactionResult = Omit<
  CommitDocumentChangeResponse,
  "currentAccessEpoch"
>;

export class CommitDocumentChangeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
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

async function pruneUnreachableAttachmentBlobs(
  blobIds: string[],
  executor: CommitChangeExecutor,
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

  // V1 attachment retention is live-only: once no active binding references a
  // blob, the detached binding rows and blob access material are not audit
  // history and are pruned with the blob bytes.
  const detachedBindings = await executor
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(
      and(
        inArray(attachmentBindings.blobId, orphanedBlobIds),
        isNotNull(attachmentBindings.detachedAt),
      ),
    );
  const detachedBindingIds = uniqueSortedStrings(
    detachedBindings.map((binding) => binding.id),
  );

  if (detachedBindingIds.length > 0) {
    await executor
      .update(attachmentBindings)
      .set({ previousBindingId: null })
      .where(inArray(attachmentBindings.previousBindingId, detachedBindingIds));
    await executor
      .delete(attachmentBindings)
      .where(inArray(attachmentBindings.id, detachedBindingIds));
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

async function ensureDocumentExists(
  executor: CommitChangeExecutor,
  documentId: string,
) {
  const document = await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (document.length === 0) {
    throw new CommitDocumentChangeError("Document not found", 404);
  }
}

async function requireWritableCommitChangeAccess(
  executor: CommitChangeExecutor,
  documentId: string,
  userId: string,
): Promise<CommitChangeAccess> {
  const access = await resolveDocumentAccessState(documentId, executor);
  if (!access) {
    throw new CommitDocumentChangeError("Document access state not found", 409);
  }
  if (!canWriteDocumentAccess(access, userId)) {
    throw new CommitDocumentChangeError("Forbidden", 403);
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
    throw new CommitDocumentChangeError(
      "Duplicate slotId in attachment mutations",
    );
  }

  const referencedSlotIds = input.loroUpdate?.referencedSlotIds ?? [];
  if (hasDuplicateValues(referencedSlotIds)) {
    throw new CommitDocumentChangeError(
      "Duplicate slotId in loroUpdate references",
    );
  }

  if (input.accessEpoch !== access.currentAccessEpoch) {
    throw new CommitDocumentChangeError("Stale access epoch", 409);
  }

  if (input.loroUpdate) {
    try {
      if (
        readLoroUpdateAccessEpoch(input.loroUpdate.encryptedData) !==
        input.accessEpoch
      ) {
        throw new CommitDocumentChangeError(
          "Encrypted update access epoch mismatch",
        );
      }
    } catch (error) {
      if (error instanceof CommitDocumentChangeError) {
        throw error;
      }
      throw new CommitDocumentChangeError("Invalid encrypted update envelope");
    }
  }

  if (
    input.documentRecipientEnvelopes &&
    !documentRecipientEnvelopesMatchRecipients(
      input.documentRecipientEnvelopes,
      access,
    )
  ) {
    throw new CommitDocumentChangeError(
      "Document recipient envelopes mismatch",
    );
  }

  return {
    referencedSlotIds,
    touchedSlotIds,
    expectedRecipientKeyFingerprints,
  };
}

async function loadActiveAttachmentBindings(
  tx: CommitChangeExecutor,
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
      throw new CommitDocumentChangeError(
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
      throw new CommitDocumentChangeError(
        `Attachment slot ${rewrap.slotId} is not bound to the expected binding`,
      );
    }
    if (
      !blobRecipientEnvelopesMatchRecipients(
        rewrap.recipientEnvelopes,
        access.cryptoRecipients,
      )
    ) {
      throw new CommitDocumentChangeError("Blob recipient envelopes mismatch");
    }

    validatedRewraps.push({ rewrap, currentBinding });
  }

  return validatedRewraps;
}

async function loadBlobStagesById(
  tx: CommitChangeExecutor,
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

function validateAttachmentCommits(input: {
  commits: CommitDocumentChangeRequest["attachmentCommits"];
  stageById: Map<string, BlobStageRow>;
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>;
  expectedRecipientKeyFingerprints: string[];
  session: CommitDocumentChangeSession;
}) {
  for (const commit of input.commits) {
    const stage = input.stageById.get(commit.stageId);
    if (!stage) {
      throw new CommitDocumentChangeError(
        `Blob stage ${commit.stageId} does not exist`,
      );
    }
    if (stage.ownerUserId !== input.session.userId) {
      throw new CommitDocumentChangeError(
        `Blob stage ${commit.stageId} does not belong to caller`,
        403,
      );
    }
    if (stage.expiresAt.getTime() <= Date.now()) {
      throw new CommitDocumentChangeError(
        `Blob stage ${commit.stageId} has expired`,
      );
    }
    if (
      (input.activeBindingBySlotId.get(commit.slotId)?.id ?? null) !==
      commit.expectedBindingId
    ) {
      throw new CommitDocumentChangeError(
        `Attachment slot ${commit.slotId} is not bound to the expected binding`,
      );
    }

    try {
      if (
        !matchesRecipientKeyFingerprints(
          listBlobRecipientKeyFingerprints(stage.encryptedBytes),
          input.expectedRecipientKeyFingerprints,
        )
      ) {
        throw new CommitDocumentChangeError(
          "Encrypted blob recipients mismatch",
        );
      }
    } catch (error) {
      if (error instanceof CommitDocumentChangeError) {
        throw error;
      }
      throw new CommitDocumentChangeError("Invalid encrypted blob envelope");
    }
  }
}

async function applyAttachmentDetaches(
  tx: CommitChangeExecutor,
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

async function applyAttachmentCommits(input: {
  tx: CommitChangeExecutor;
  documentId: string;
  commits: CommitDocumentChangeRequest["attachmentCommits"];
  stageById: Map<string, BlobStageRow>;
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>;
  affectedBlobIds: Set<string>;
}) {
  const committedBindings: CommitDocumentChangeResponse["committedBindings"] =
    [];
  const detachedBindingIds: string[] = [];

  for (const commit of input.commits) {
    const stage = input.stageById.get(commit.stageId);
    if (!stage) {
      throw new CommitDocumentChangeError(
        `Blob stage ${commit.stageId} does not exist`,
      );
    }

    const currentBinding =
      input.activeBindingBySlotId.get(commit.slotId) ?? null;
    if (currentBinding) {
      await input.tx
        .update(attachmentBindings)
        .set({ detachedAt: new Date() })
        .where(eq(attachmentBindings.id, currentBinding.id));
      detachedBindingIds.push(currentBinding.id);
      input.affectedBlobIds.add(currentBinding.blobId);
    }

    const [blob] = await input.tx
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

    const [binding] = await input.tx
      .insert(attachmentBindings)
      .values({
        documentId: input.documentId,
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
    input.affectedBlobIds.add(blob.id);
    input.activeBindingBySlotId.set(commit.slotId, {
      id: binding.id,
      slotId: commit.slotId,
      blobId: blob.id,
    });
    await input.tx.delete(blobStages).where(eq(blobStages.id, stage.id));
  }

  return { committedBindings, detachedBindingIds };
}

function validateReferencedSlots(
  referencedSlotIds: string[],
  activeBindingBySlotId: Map<string, ActiveAttachmentBinding>,
) {
  for (const slotId of referencedSlotIds) {
    if (!activeBindingBySlotId.has(slotId)) {
      throw new CommitDocumentChangeError(
        `Loro update references slot ${slotId} without an active binding`,
      );
    }
  }
}

async function validateCommitDocumentLoroCheckpoint(input: {
  currentAccessEpoch: number;
  currentDocumentRecipientEnvelopes: ReadonlyArray<unknown> | null;
  documentId: string;
  documentRecipientEnvelopeAction: "none" | "rewrap" | "rotate";
  documentRecipientEnvelopes:
    | CommitDocumentChangeRequest["documentRecipientEnvelopes"]
    | undefined;
  executor: CommitChangeExecutor;
  loroUpdate: NonNullable<CommitDocumentChangeRequest["loroUpdate"]>;
}) {
  const rotateBaselineSourceError = await getRotateBaselineSourceError({
    currentAccessEpoch: input.currentAccessEpoch,
    currentDocumentRecipientEnvelopes: input.currentDocumentRecipientEnvelopes,
    documentId: input.documentId,
    documentRecipientEnvelopeAction: input.documentRecipientEnvelopeAction,
    documentRecipientEnvelopes: input.documentRecipientEnvelopes,
    executor: input.executor,
    updates: [input.loroUpdate],
  });
  if (rotateBaselineSourceError) {
    throw new CommitDocumentChangeError(
      rotateBaselineSourceError.message,
      rotateBaselineSourceError.status,
    );
  }

  const checkpointError = getDocumentCheckpointInputError({
    documentRecipientEnvelopeAction: input.documentRecipientEnvelopeAction,
    updates: [input.loroUpdate],
  });
  if (checkpointError) {
    throw new CommitDocumentChangeError(
      checkpointError.message,
      checkpointError.status,
    );
  }
}

async function resolveCommitDocumentRecipientEnvelopes(input: {
  access: CommitChangeAccess;
  currentDocumentRecipientEnvelopes: Awaited<
    ReturnType<typeof listDocumentRecipientEnvelopes>
  >;
  documentId: string;
  documentRecipientEnvelopes:
    | CommitDocumentChangeRequest["documentRecipientEnvelopes"]
    | undefined;
  executor: CommitChangeExecutor;
}) {
  let currentDocumentRecipientEnvelopes =
    input.currentDocumentRecipientEnvelopes;

  if (input.documentRecipientEnvelopes) {
    try {
      currentDocumentRecipientEnvelopes = await putDocumentRecipientEnvelopes(
        input.documentId,
        input.access.currentAccessEpoch,
        input.access,
        input.documentRecipientEnvelopes,
        input.executor,
      );
    } catch (error) {
      if (error instanceof DocumentRecipientEnvelopeConflictError) {
        throw new CommitDocumentChangeError(error.message, 409);
      }
      throw error;
    }
  }

  if (
    !currentDocumentRecipientEnvelopes ||
    currentDocumentRecipientEnvelopes.length === 0
  ) {
    throw new CommitDocumentChangeError(
      "Missing document recipient envelopes for current epoch",
    );
  }

  return currentDocumentRecipientEnvelopes;
}

async function commitDocumentLoroUpdate(
  tx: CommitChangeExecutor,
  input: CommitDocumentChangeRequest,
  documentId: string,
  access: CommitChangeAccess,
  session: CommitDocumentChangeSession,
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

  const documentRecipientEnvelopeAction =
    await getDocumentRecipientEnvelopeAction(documentId, access, tx);
  await validateCommitDocumentLoroCheckpoint({
    currentAccessEpoch: access.currentAccessEpoch,
    currentDocumentRecipientEnvelopes,
    documentId,
    documentRecipientEnvelopeAction,
    documentRecipientEnvelopes: input.documentRecipientEnvelopes,
    executor: tx,
    loroUpdate: input.loroUpdate,
  });
  currentDocumentRecipientEnvelopes =
    await resolveCommitDocumentRecipientEnvelopes({
      access,
      currentDocumentRecipientEnvelopes,
      documentId,
      documentRecipientEnvelopes: input.documentRecipientEnvelopes,
      executor: tx,
    });

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
      accessEpoch: input.accessEpoch,
      authorFingerprint: session.fingerprint,
      encryptedData: input.loroUpdate.encryptedData,
      partialStartVersionVector: input.loroUpdate.partialStartVersionVector,
      partialEndVersionVector: input.loroUpdate.partialEndVersionVector,
    })
    .returning({ id: documentUpdates.id });
  if (inserted) {
    await insertDocumentUpdateSpans(tx, {
      documentId,
      updates: [input.loroUpdate],
    });
    await maybeWriteDocumentAuditCheckpoint(tx, {
      accessEpoch: access.currentAccessEpoch,
      accessFingerprint: access.accessFingerprint,
      actorFingerprint: session.fingerprint,
      actorUserId: session.userId,
      checkpointUpdate: input.loroUpdate,
      documentId,
    });
    acceptedOutgoingUpdateIds.push(inserted.id);
  }

  return { acceptedOutgoingUpdateIds, currentDocumentRecipientEnvelopes };
}

async function applyAttachmentRewraps(
  tx: CommitChangeExecutor,
  validatedRewraps: ValidatedAttachmentRewrap[],
) {
  for (const { rewrap, currentBinding } of validatedRewraps) {
    const blobAccess = await resolveBlobAccessState(currentBinding.blobId, tx);
    if (!blobAccess) {
      throw new CommitDocumentChangeError("Blob access state not found", 409);
    }

    const blobRecipientEnvelopeAction = await getBlobRecipientEnvelopeAction(
      currentBinding.blobId,
      blobAccess,
      tx,
    );
    if (blobRecipientEnvelopeAction === "rotate") {
      throw new CommitDocumentChangeError(
        "Blob recipient envelopes require blob replacement after access shrink",
        409,
      );
    }

    await replaceBlobRecipientEnvelopes(
      currentBinding.blobId,
      blobAccess.currentAccessEpoch,
      blobAccess.cryptoRecipients,
      rewrap.recipientEnvelopes,
      tx,
    );
  }
}

async function runCommitChangeTransaction(input: {
  runtime: ApiServiceRuntime;
  request: CommitDocumentChangeRequest;
  access: CommitChangeAccess;
  documentId: string;
  expectedRecipientKeyFingerprints: string[];
  referencedSlotIds: string[];
  session: CommitDocumentChangeSession;
  touchedSlotIds: string[];
}): Promise<CommitChangeTransactionResult> {
  return input.runtime.db.transaction(async (tx) => {
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
      input.request.attachmentDetaches,
      activeBindingBySlotId,
    );
    const validatedRewraps = validateAttachmentRewraps(
      input.request.attachmentRewraps,
      input.access,
      activeBindingBySlotId,
    );
    const stageById = await loadBlobStagesById(
      tx,
      input.request.attachmentCommits,
    );
    validateAttachmentCommits({
      commits: input.request.attachmentCommits,
      stageById,
      activeBindingBySlotId,
      expectedRecipientKeyFingerprints: input.expectedRecipientKeyFingerprints,
      session: input.session,
    });

    const affectedBlobIds = new Set<string>();
    const detachedBindingIds = await applyAttachmentDetaches(
      tx,
      input.request.attachmentDetaches,
      activeBindingBySlotId,
      affectedBlobIds,
    );
    for (const { currentBinding } of validatedRewraps) {
      affectedBlobIds.add(currentBinding.blobId);
    }

    const committed = await applyAttachmentCommits({
      tx,
      documentId: input.documentId,
      commits: input.request.attachmentCommits,
      stageById,
      activeBindingBySlotId,
      affectedBlobIds,
    });
    validateReferencedSlots(input.referencedSlotIds, activeBindingBySlotId);
    const loroUpdateResult = await commitDocumentLoroUpdate(
      tx,
      input.request,
      input.documentId,
      input.access,
      input.session,
    );

    const activeBlobIds = await pruneUnreachableAttachmentBlobs(
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

export async function commitDocumentChange(
  runtime: ApiServiceRuntime,
  input: CommitDocumentChangeInput,
): Promise<CommitDocumentChangeResponse> {
  await ensureDocumentExists(runtime.db, input.documentId);
  const access = await requireWritableCommitChangeAccess(
    runtime.db,
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
    runtime,
    request: input.request,
    access,
    documentId: input.documentId,
    expectedRecipientKeyFingerprints,
    referencedSlotIds: validatedInput.referencedSlotIds,
    session: input.session,
    touchedSlotIds: validatedInput.touchedSlotIds,
  });

  return {
    currentAccessEpoch: access.currentAccessEpoch,
    ...result,
  };
}
