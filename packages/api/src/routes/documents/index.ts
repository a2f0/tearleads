import { replaceBlobEnvelopeRecipients } from "@tearleads/crypto";
import {
  emptyVersionVector,
  mergeVersionVectors,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createLoroRouter } from "@tearleads/loro/server";
import {
  type CommitDocumentChangeRequest,
  isCommitDocumentChangeRequest,
  isStageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobResponse,
  ListDocumentAttachmentsResponse,
  StageBlobResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { validator } from "hono/validator";
import {
  blobRecipientEnvelopesMatchRecipients,
  canReadBlobAccess,
  getBlobRecipientEnvelopeAction,
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
  DocumentRecipientEnvelopeConflictError,
  documentRecipientEnvelopesMatchRecipients,
  getDocumentRecipientEnvelopeAction,
  initializeDocumentAccess,
  listDocumentRecipientEnvelopes,
  listRecipientEncapsulationPublicKeys,
  listRecipientKeyFingerprints,
  putDocumentRecipientEnvelopes,
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
import { StageBlobError, stageBlob } from "../../services/documents/stageBlob";
import { defaultApiServiceRuntime } from "../../services/runtime";
import { uniqueSortedStrings } from "../../utils/array";
import {
  listBlobRecipientKeyFingerprints,
  readLoroUpdateAccessEpoch,
} from "../../utils/recipientEnvelopes";
import { sha256Hex } from "../../utils/sha256";

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

interface RotateBaselineUpdate {
  partialEndVersionVector: string;
  sourceVersionVector?: string;
}

interface AppendDocumentUpdate extends RotateBaselineUpdate {
  encryptedData: string;
  id: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
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

async function getPriorEpochDocumentVersionVector(
  documentId: string,
  currentAccessEpoch: number,
  executor: DocumentRouteExecutor = db,
): Promise<string> {
  const rows = await executor
    .select({
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
    })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, documentId),
        lt(documentUpdates.accessEpoch, currentAccessEpoch),
      ),
    );

  if (rows.length === 0) {
    return emptyVersionVector();
  }

  return mergeVersionVectors(rows.map((row) => row.partialEndVersionVector));
}

async function getRotateBaselineSourceError(input: {
  currentAccessEpoch: number;
  currentDocumentRecipientEnvelopes: ReadonlyArray<unknown> | null;
  documentId: string;
  documentRecipientEnvelopeAction: "none" | "rewrap" | "rotate";
  documentRecipientEnvelopes:
    | CommitDocumentChangeRequest["documentRecipientEnvelopes"]
    | undefined;
  executor: DocumentRouteExecutor;
  updates: ReadonlyArray<RotateBaselineUpdate>;
}): Promise<{ message: string; status: 400 | 409 } | null> {
  if (
    input.documentRecipientEnvelopeAction !== "rotate" ||
    !input.documentRecipientEnvelopes ||
    (input.currentDocumentRecipientEnvelopes &&
      input.currentDocumentRecipientEnvelopes.length > 0)
  ) {
    return null;
  }

  if (input.updates.length !== 1) {
    return {
      message: "Rotate baseline requires exactly one document update",
      status: 400,
    };
  }

  const update = input.updates[0];
  if (!update?.sourceVersionVector) {
    return {
      message: "Missing rotate baseline source version vector",
      status: 400,
    };
  }

  const expectedSourceVersionVector = await getPriorEpochDocumentVersionVector(
    input.documentId,
    input.currentAccessEpoch,
    input.executor,
  );

  if (
    !versionVectorsEqual(
      update.sourceVersionVector,
      expectedSourceVersionVector,
    )
  ) {
    return {
      message: "Stale rotate baseline source version vector",
      status: 409,
    };
  }

  if (
    !satisfiesVersionVector(
      update.partialEndVersionVector,
      expectedSourceVersionVector,
    )
  ) {
    return {
      message:
        "Rotate baseline frontier does not cover all prior-epoch updates",
      status: 409,
    };
  }

  return null;
}

async function pruneUnreachableAttachmentBlobs(
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
        access.cryptoRecipients,
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

  const documentRecipientEnvelopeAction =
    await getDocumentRecipientEnvelopeAction(documentId, access, tx);
  const rotateBaselineSourceError = await getRotateBaselineSourceError({
    currentAccessEpoch: access.currentAccessEpoch,
    currentDocumentRecipientEnvelopes,
    documentId,
    documentRecipientEnvelopeAction,
    documentRecipientEnvelopes: input.documentRecipientEnvelopes,
    executor: tx,
    updates: [input.loroUpdate],
  });
  if (rotateBaselineSourceError) {
    throw new CommitChangeError(
      rotateBaselineSourceError.message,
      rotateBaselineSourceError.status,
    );
  }

  if (input.documentRecipientEnvelopes) {
    try {
      currentDocumentRecipientEnvelopes = await putDocumentRecipientEnvelopes(
        documentId,
        access.currentAccessEpoch,
        access,
        input.documentRecipientEnvelopes,
        tx,
      );
    } catch (error) {
      if (error instanceof DocumentRecipientEnvelopeConflictError) {
        throw new CommitChangeError(error.message, 409);
      }
      throw error;
    }
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
      accessEpoch: input.accessEpoch,
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

    const blobRecipientEnvelopeAction = await getBlobRecipientEnvelopeAction(
      currentBinding.blobId,
      blobAccess,
      tx,
    );
    if (blobRecipientEnvelopeAction === "rotate") {
      throw new CommitChangeError(
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

async function validateAppendDocumentUpdatesInput(input: {
  access: CommitChangeAccess;
  documentId: string;
  documentRecipientEnvelopes:
    | CommitDocumentChangeRequest["documentRecipientEnvelopes"]
    | undefined;
  executor: DocumentRouteExecutor;
  updates: ReadonlyArray<AppendDocumentUpdate>;
}) {
  const existingEnvelopes = await listDocumentRecipientEnvelopes(
    input.documentId,
    input.access.currentAccessEpoch,
    input.executor,
  );
  const nextEnvelopes = input.documentRecipientEnvelopes ?? existingEnvelopes;

  if (!nextEnvelopes || nextEnvelopes.length === 0) {
    throw new DocumentUpdateError(
      "Missing document recipient envelopes for current epoch",
      400,
    );
  }

  if (
    input.documentRecipientEnvelopes &&
    !documentRecipientEnvelopesMatchRecipients(
      input.documentRecipientEnvelopes,
      input.access,
    )
  ) {
    throw new DocumentUpdateError("Document recipient envelopes mismatch", 400);
  }

  const documentRecipientEnvelopeAction =
    await getDocumentRecipientEnvelopeAction(
      input.documentId,
      input.access,
      input.executor,
    );
  const rotateBaselineSourceError = await getRotateBaselineSourceError({
    currentAccessEpoch: input.access.currentAccessEpoch,
    currentDocumentRecipientEnvelopes: existingEnvelopes,
    documentId: input.documentId,
    documentRecipientEnvelopeAction,
    documentRecipientEnvelopes: input.documentRecipientEnvelopes,
    executor: input.executor,
    updates: input.updates,
  });
  if (rotateBaselineSourceError) {
    throw new DocumentUpdateError(
      rotateBaselineSourceError.message,
      rotateBaselineSourceError.status,
    );
  }
}

async function putAppendDocumentRecipientEnvelopes(input: {
  access: CommitChangeAccess;
  documentId: string;
  documentRecipientEnvelopes:
    | CommitDocumentChangeRequest["documentRecipientEnvelopes"]
    | undefined;
  executor: DocumentRouteExecutor;
}): Promise<
  Awaited<ReturnType<typeof putDocumentRecipientEnvelopes>> | undefined
> {
  if (!input.documentRecipientEnvelopes) {
    return undefined;
  }

  try {
    return await putDocumentRecipientEnvelopes(
      input.documentId,
      input.access.currentAccessEpoch,
      input.access,
      input.documentRecipientEnvelopes,
      input.executor,
    );
  } catch (error) {
    if (error instanceof DocumentRecipientEnvelopeConflictError) {
      throw new DocumentUpdateError(error.message, 409);
    }
    throw error;
  }
}

async function appendMissingDocumentUpdates(input: {
  accessEpoch: number;
  authorFingerprint: string;
  documentId: string;
  executor: DocumentRouteExecutor;
  updates: ReadonlyArray<AppendDocumentUpdate>;
}): Promise<string[]> {
  if (input.updates.length === 0) {
    return [];
  }

  const updateIds = uniqueSortedStrings(
    input.updates.map((update) => update.id),
  );
  const existingRows = await input.executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(inArray(documentUpdates.id, updateIds));
  const acceptedUpdateIds = new Set(existingRows.map((row) => row.id));
  const newUpdates: AppendDocumentUpdate[] = [];

  for (const update of input.updates) {
    if (acceptedUpdateIds.has(update.id)) {
      continue;
    }

    acceptedUpdateIds.add(update.id);
    newUpdates.push(update);
  }

  if (newUpdates.length > 0) {
    const insertedRows = await input.executor
      .insert(documentUpdates)
      .values(
        newUpdates.map((update) => ({
          id: update.id,
          documentId: input.documentId,
          accessEpoch: input.accessEpoch,
          authorFingerprint: input.authorFingerprint,
          encryptedData: update.encryptedData,
          partialStartVersionVector: update.partialStartVersionVector,
          partialEndVersionVector: update.partialEndVersionVector,
        })),
      )
      .returning({ id: documentUpdates.id });

    acceptedUpdateIds.clear();
    for (const row of [...existingRows, ...insertedRows]) {
      acceptedUpdateIds.add(row.id);
    }
  }

  return input.updates
    .filter((update) => acceptedUpdateIds.has(update.id))
    .map((update) => update.id);
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
      const documentRecipientEnvelopeAction =
        await getDocumentRecipientEnvelopeAction(documentId, access);

      return {
        canRead: canReadDocumentAccess(access, userId),
        canWrite: canWriteDocumentAccess(access, userId),
        currentAccessEpoch: access.currentAccessEpoch,
        documentRecipientEnvelopeAction,
        documentRecipientEnvelopes: await listDocumentRecipientEnvelopes(
          documentId,
          access.currentAccessEpoch,
        ),
        rotateBaselineSourceVersionVector:
          documentRecipientEnvelopeAction === "rotate"
            ? await getPriorEpochDocumentVersionVector(
                documentId,
                access.currentAccessEpoch,
              )
            : null,
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
      return db.transaction(async (tx) => {
        const access = await resolveDocumentAccessState(documentId, tx);
        if (!access) {
          throw new DocumentUpdateError("Document access state not found", 409);
        }

        await validateAppendDocumentUpdatesInput({
          access,
          documentId,
          documentRecipientEnvelopes,
          executor: tx,
          updates,
        });
        const canonicalDocumentRecipientEnvelopes =
          await putAppendDocumentRecipientEnvelopes({
            access,
            documentId,
            documentRecipientEnvelopes,
            executor: tx,
          });
        const acceptedUpdateIds = await appendMissingDocumentUpdates({
          accessEpoch: access.currentAccessEpoch,
          authorFingerprint,
          documentId,
          executor: tx,
          updates,
        });

        return {
          acceptedOutgoingUpdateIds: acceptedUpdateIds,
          documentRecipientEnvelopes: canonicalDocumentRecipientEnvelopes,
        };
      });
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

    try {
      return c.json<StageBlobResponse>(
        await stageBlob(defaultApiServiceRuntime, {
          ...c.req.valid("json"),
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof StageBlobError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
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
