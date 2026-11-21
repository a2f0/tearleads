import { exportFullHistorySnapshot } from "@tearleads/loro";
import { isRejectedDecodedProjection } from "@tearleads/validators/response";
import {
  type AttachmentRemovalMarker,
  isOpenAttachmentRemovalMarker,
  type OpenAttachmentRemovalMarker,
  observeMarkerBinding,
  transitionAttachmentRemovalMarker,
} from "../../../../data/documents/attachmentRemovalMarkerMachine";
import { getDocumentAttachments } from "../../../../data/documents/documentContent";
import { errorMessage } from "../../../../data/shared/errorMessage";
import {
  type DocumentRecord,
  resolveDocumentCreateAuthor,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { requestDocumentStoreSync } from "../../registry";
import { upsertPendingAttachments } from "../attachments/attachmentPersistence";
import {
  type AttachmentRemovalMarkerSlot,
  listAttachmentRemovalMarkers,
  settleStoreAttachmentRemovalMarker,
} from "../attachments/attachmentRemovalMarkers";
import { reloadDocumentFromDurableHistory } from "../history/durableDocumentReload";
import { chainQueuedWrite } from "../localWriteQueue";
import type {
  DocumentAttachmentBinding,
  DocumentState,
  DocumentStoreState,
} from "../state";
import { installDocumentWriterProjection } from "../writerProjectionGeneration";
import { readReplacedBindingSightings } from "./replacedBindingSightings";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreGenerationIdentityCurrent,
  isDocumentStoreSyncGenerationCurrent,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";
import { documentSyncContextMatches } from "./syncUpdateImport";

/**
 * Detach the remote bindings of attachment slots this store removed.
 *
 * Each removal marker is settled against committed document history before
 * any detach is sent, and again after one lands: another pane, or a pull from
 * another device, can add the slot back at any point, and only committed
 * history (never a live document that may hold a staged edit that later rolls
 * back) says whether it did. A re-added slot keeps its binding and held copy,
 * one re-added with other bytes frees its first download, and one re-added
 * while its binding was being detached has its held bytes queued to upload
 * and bind again. A binding of another blob may be another writer's re-add,
 * bound before the content update that records it arrives here, so it is
 * detached only once a pass after a completed pull still lists it.
 */
export async function syncDetachedAttachmentBindings(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  generation: DocumentStoreSyncGeneration,
  policyOperation: PrincipalPolicyOperation,
): Promise<void> {
  const currentDoc = generation.currentDoc;
  if (
    !currentDoc ||
    !detachedSyncContextIsCurrent(state, generation, nextRecord)
  ) {
    return;
  }

  const markers = await listAttachmentRemovalMarkers(state, currentDoc);
  if (
    markers.length === 0 ||
    !detachedSyncContextIsCurrent(state, generation, nextRecord)
  ) {
    return;
  }

  const contextIsCurrent = () =>
    detachedSyncContextIsCurrent(state, generation, nextRecord);
  const activeBindingBySlotId = await listActiveBindings(
    state,
    nextRecord.documentId,
    contextIsCurrent,
  );
  if (!activeBindingBySlotId) return;

  const { readdedSlotIds, rebinding } = await settleDetachMarkers({
    activeBindingBySlotId,
    contextIsCurrent,
    currentDoc,
    generation,
    markers,
    policyOperation,
    requestRecord: nextRecord,
    state,
  });
  if (readdedSlotIds.length > 0) {
    void catchUpReaddedAttachments(
      state,
      generation,
      readdedSlotIds,
      rebinding,
    );
  }
}

/** Settle each marker in turn, stopping at the first that cannot finish. */
async function settleDetachMarkers(
  input: Omit<
    Parameters<typeof settleDetachedAttachmentMarker>[0],
    "binding" | "marker" | "replacedBindingId"
  > & {
    activeBindingBySlotId: ReadonlyMap<string, DocumentAttachmentBinding>;
    markers: readonly AttachmentRemovalMarkerSlot[];
  },
): Promise<{ readdedSlotIds: string[]; rebinding: boolean }> {
  const { activeBindingBySlotId, markers, ...context } = input;
  const sightings = readReplacedBindingSightings(
    context.state,
    context.requestRecord.documentId ?? "",
  );
  let sighted = false;
  const readdedSlotIds: string[] = [];
  let rebinding = false;
  for (const marker of markers) {
    const binding = activeBindingBySlotId.get(marker.slotId);
    const settled = await settleDetachedAttachmentMarker({
      ...context,
      binding,
      marker,
      replacedBindingId: sightings.confirmed(marker.slotId),
    });
    if (!settled) break;
    if (settled.status === "bindingReplaced" && binding) {
      sighted = sightings.sight(marker.slotId, binding.bindingId) || sighted;
    } else {
      sightings.forget(marker.slotId);
    }
    if (settled.status === "held" || settled.status === "rebinding") {
      readdedSlotIds.push(marker.slotId);
    }
    rebinding ||= settled.status === "rebinding";
  }
  // Ask for a pass that pulls rather than skipping a clean document: a
  // binding still listed after it is the removed slot's. Sightings live in
  // memory only, so waiting for an unrelated pass could outlast the session.
  if (sighted) {
    markDocumentStoreRemoteSyncPending(context.state, "independent");
    requestDocumentStoreSync(context.state);
  }
  return { readdedSlotIds, rebinding };
}

/**
 * The slot bindings the server lists for the document, fresh rather than
 * cached: whether a re-added slot still has a binding decides between keeping
 * its copy and uploading it again. A document that never synced has none.
 * Null when the listing failed or the pass went stale.
 */
async function listActiveBindings(
  state: DocumentStoreState,
  remoteDocumentId: string | null | undefined,
  contextIsCurrent: () => boolean,
): Promise<Map<string, DocumentAttachmentBinding> | null> {
  if (!remoteDocumentId) return new Map();
  const remoteBindings = await state.runtime.apiClient.listDocumentAttachments(
    remoteDocumentId,
    { refresh: true },
  );
  if (!remoteBindings || !contextIsCurrent()) return null;
  return new Map(remoteBindings.map((binding) => [binding.slotId, binding]));
}

/**
 * Settle one marker: committed history first, then the detach it still owes,
 * then committed history again for a re-add that landed while it was sent.
 * Null stops the pass, leaving the marker for a later one.
 */
async function settleDetachedAttachmentMarker(input: {
  binding: DocumentAttachmentBinding | undefined;
  contextIsCurrent: () => boolean;
  currentDoc: DocumentState;
  generation: DocumentStoreSyncGeneration;
  marker: AttachmentRemovalMarkerSlot;
  policyOperation: PrincipalPolicyOperation;
  replacedBindingId: string | undefined;
  requestRecord: DocumentRecord;
  state: DocumentStoreState;
}): Promise<AttachmentRemovalMarker | null> {
  const { binding, marker, requestRecord, state } = input;
  const settle = (from: OpenAttachmentRemovalMarker) =>
    settleStoreAttachmentRemovalMarker({
      doc: input.currentDoc,
      from,
      marker,
      state,
      stillCurrent: input.contextIsCurrent,
    });
  const settled = await settle(
    observeMarkerBinding(binding, marker.blobId, input.replacedBindingId),
  );
  // A slot the live document records is only realigned, never detached: a
  // staged re-add may yet commit.
  if (settled?.status !== "awaitingDetach" || marker.recorded) return settled;
  if (
    !binding ||
    !requestRecord.documentId ||
    !(await syncDetachedAttachmentBinding({
      binding,
      generation: input.generation,
      policyOperation: input.policyOperation,
      remoteDocumentId: requestRecord.documentId,
      requestRecord,
      state,
    }))
  ) {
    return null;
  }
  // The binding is gone, so a slot committed again meanwhile needs its held
  // bytes bound anew.
  const detached = transitionAttachmentRemovalMarker(settled, {
    type: "remoteDetachSettled",
  });
  return isOpenAttachmentRemovalMarker(detached) ? settle(detached) : detached;
}

/**
 * Bring the live document up to the committed history that added these slots
 * back. Until it records them, every pass would list them as markers again,
 * and the upload lane drops, durably, an upload the live document does not
 * record, so a requeued upload is published only after the catch-up. It runs
 * in the write chain, as every reload of a write's base does.
 */
function catchUpReaddedAttachments(
  state: DocumentStoreState,
  passGeneration: DocumentStoreSyncGeneration,
  slotIds: readonly string[],
  requestUpload: boolean,
): Promise<void> {
  const passIsCurrent = () =>
    isDocumentStoreGenerationIdentityCurrent(state, passGeneration);
  return chainQueuedWrite(
    state,
    state.writeChain
      .catch(() => undefined)
      .then(async () => {
        const doc = state.doc;
        if (!doc || !passIsCurrent()) return;
        if (!documentRecordsSlots(doc, slotIds)) {
          const generation = captureDocumentStoreSyncGeneration(state, doc);
          if (!generation) return;
          await reloadDocumentFromDurableHistory({
            expectedGeneration: generation,
            preserveQueuedWritesWhenIdentityMatches: true,
            sameIdentitySnapshot: exportFullHistorySnapshot(doc).slice(),
            state,
          });
        }
        if (
          requestUpload &&
          (await publishRequeuedUploads(state, slotIds, passIsCurrent))
        ) {
          requestDocumentStoreSync(state);
        }
      })
      .catch((error: unknown) => {
        state.runtime.util.log(
          `Documents: re-added attachment reload failed: ${errorMessage(error)}`,
        );
      }),
  );
}

/**
 * Hand the upload lane the uploads a `rebinding` settle queued durably, once
 * the live document records their slots; a later startup publishes any the
 * pane could not catch up with.
 */
async function publishRequeuedUploads(
  state: DocumentStoreState,
  slotIds: readonly string[],
  passIsCurrent: () => boolean,
): Promise<boolean> {
  const doc = state.doc;
  if (!doc || !passIsCurrent() || !documentRecordsSlots(doc, slotIds)) {
    return false;
  }
  const pending = await state.persistence.listPendingAttachments(
    state.runtime.infra.execSql,
    state.localId,
  );
  if (state.doc !== doc || !passIsCurrent()) return false;
  const requeued = pending.filter((row) => slotIds.includes(row.slotId));
  if (requeued.length === 0) return false;
  upsertPendingAttachments(state, requeued);
  return true;
}

function documentRecordsSlots(
  doc: DocumentState,
  slotIds: readonly string[],
): boolean {
  const recorded = new Set(
    getDocumentAttachments(doc).map((attachment) => attachment.slotId),
  );
  return slotIds.every((slotId) => recorded.has(slotId));
}

function detachedSyncContextIsCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  requestRecord: DocumentRecord,
): boolean {
  return (
    !state.runtime.util.deferAttachmentDetaches &&
    isDocumentStoreSyncGenerationCurrent(state, generation) &&
    documentSyncContextMatches(
      state.record,
      requestRecord,
      requestRecord.documentId,
    )
  );
}

async function syncDetachedAttachmentBinding(input: {
  binding: DocumentAttachmentBinding;
  generation: DocumentStoreSyncGeneration;
  policyOperation: PrincipalPolicyOperation;
  remoteDocumentId: string;
  requestRecord: DocumentRecord;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { binding, generation, requestRecord, state } = input;
  const contextIsCurrent = () =>
    detachedSyncContextIsCurrent(state, generation, requestRecord);
  if (!contextIsCurrent()) return false;

  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(
      "Documents: skipped attachment detach because the writer context is unavailable.",
    );
    return false;
  }

  const writerProjection =
    state.writerProjection?.documentId === input.remoteDocumentId &&
    !isRejectedDecodedProjection(state.writerProjection)
      ? state.writerProjection
      : null;
  const writerProjectionGeneration = state.writerProjectionGeneration;
  let remoteSyncBlocked = false;
  // Read with the currency check above, so its executor is this generation's.
  const { blobAttachments } = state.runtime;
  const baseDetachInput = {
    author,
    bindingId: binding.bindingId,
    blobId: binding.blobId,
    documentId: input.remoteDocumentId,
    isRemoteSyncBlocked: (organizationId: string) => {
      remoteSyncBlocked =
        state.runtime.util.isRemoteSyncBlocked?.(organizationId) ?? false;
      return remoteSyncBlocked;
    },
    resolveProjectionUserKey: generation.resolveProjectionUserKey,
    slotId: binding.slotId,
    stillCurrent: contextIsCurrent,
    warmReferencedPrincipalPolicies:
      state.runtime.principalPolicies.createWarmer({
        operation: input.policyOperation,
      }),
  };
  let detached = await blobAttachments.detachDocumentAttachment({
    ...baseDetachInput,
    writerProjection: writerProjection ?? undefined,
  });
  if (!contextIsCurrent()) return false;
  if (!detached && writerProjection && !remoteSyncBlocked) {
    state.writerProjection = null;
    detached = await blobAttachments.detachDocumentAttachment(baseDetachInput);
    if (!contextIsCurrent()) return false;
  }
  if (!detached) {
    return false;
  }

  installDocumentWriterProjection(
    state,
    detached.writerProjection,
    writerProjectionGeneration,
  );
  state.runtime.util.log(
    `Detached attachment ${binding.slotId} from document ${input.remoteDocumentId}.`,
  );
  return true;
}
