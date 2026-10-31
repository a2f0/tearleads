import { encodeVersionVector } from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentCreateSeedResponse } from "@tearleads/validators/response";
import {
  type DocumentRecord,
  documentCreateSeedCandidate,
  type PendingUpdateRecord,
} from "../../../../workflows/documents";
import { chainIdentityWrite } from "../identityWriteChain";
import { listPendingUpdates } from "../persistence";
import type {
  DocumentState,
  DocumentStoreState,
  EncapsulationKeyPair,
} from "../state";
import { persistBindCarriedSeed } from "./createdDocumentPersistence";
import {
  cleanupPreRegisteredUpdateIdsOnFailure,
  discardPreRegisteredUpdateIds,
  preRegisterMaterializedDocumentSyncUpdateIds,
} from "./syncAcceptedUpdateIds";
import { isNewPendingAttachmentSlot } from "./syncAttachmentSettlement";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { ensureRemoteDocument } from "./syncShared";
import { documentSyncContextMatches } from "./syncUpdateImport";

/**
 * The document's deferred first update, signed by the create that preceded
 * its attachment's bind: the bind carries it, so its content never reaches
 * the server before the binding it names.
 */
export interface CarriedFirstUpdate {
  readonly request: DocumentSyncRequest;
  readonly update: PendingUpdateRecord;
}

/**
 * The queued row the create may sign for the bind to carry: the document's
 * whole content, held back for exactly one fresh attachment. With more
 * attachments the row names slots a single bind does not commit.
 */
async function deferredFirstUpdateCandidate(
  state: DocumentStoreState,
  currentDoc: DocumentState,
): Promise<PendingUpdateRecord | null> {
  const [pendingAttachment, ...others] = state.pendingAttachments;
  if (
    !pendingAttachment ||
    others.length > 0 ||
    pendingAttachment.upload != null ||
    !isNewPendingAttachmentSlot(state, pendingAttachment)
  ) {
    return null;
  }
  return documentCreateSeedCandidate({
    documentVersion: encodeVersionVector(currentDoc),
    pendingUpdates: await listPendingUpdates(state),
  });
}

/**
 * Creates the remote document for its attachment's first upload. When the
 * queue holds the deferred first update, the create signs it without sending
 * it and `onCarried` receives it for the bind to carry.
 */
export async function ensureRemoteDocumentCarryingFirstUpdate(input: {
  readonly currentDoc: DocumentState;
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  readonly generation: DocumentStoreSyncGeneration;
  readonly nextRecord: DocumentRecord;
  readonly onCarried: (carried: CarriedFirstUpdate) => void;
  readonly state: DocumentStoreState;
}): Promise<DocumentRecord | null> {
  const update = await deferredFirstUpdateCandidate(
    input.state,
    input.currentDoc,
  );
  return ensureRemoteDocument(
    input.state,
    input.currentDoc,
    input.nextRecord,
    input.encapsulationKeyPair,
    input.generation,
    undefined,
    update
      ? {
          onSigned: (request) => input.onCarried({ request, update }),
          update,
        }
      : undefined,
  );
}

/**
 * Settles the carried update when the bind's acknowledgement names it. A bind
 * that dropped it (a refused carry falls back to a plain bind) or failed
 * leaves the row queued, so the pass's document sync ships it alone.
 */
async function settleCarriedFirstUpdate(input: {
  readonly attachmentGeneration: DocumentStoreSyncGeneration;
  readonly carried: CarriedFirstUpdate;
  readonly committed: DocumentCreateSeedResponse | undefined;
  readonly remoteDocumentId: string;
  readonly requestRecord: DocumentRecord | null;
  readonly state: DocumentStoreState;
}): Promise<boolean> {
  const { requestRecord, state } = input;
  if (!requestRecord) return false;
  // A relink during the bind leaves the attachment generation current, but
  // the acknowledgement describes the old document: settle only while the
  // identity and security context the bind ran under are still live, on the
  // identity-write chain so a relink cannot interleave.
  const contextCurrent = () =>
    isDocumentStoreSyncGenerationCurrent(state, input.attachmentGeneration) &&
    documentSyncContextMatches(
      state.record,
      requestRecord,
      input.remoteDocumentId,
    );
  return chainIdentityWrite(state, async () => {
    if (!state.doc || !contextCurrent()) return false;
    return persistBindCarriedSeed({
      committed: input.committed,
      currentDoc: state.doc,
      generation: input.attachmentGeneration,
      state,
      stillCurrent: contextCurrent,
      update: input.carried.update,
    });
  });
}

/**
 * Runs the upload whose bind carries `carried`. Its id is registered before
 * the network await, as a sync registers its sent ids, so the update's own
 * echo is classified as self-authored; the registration is dropped unless
 * the row settles.
 */
export async function uploadCarryingFirstUpdate<Result>(input: {
  readonly attachmentGeneration: DocumentStoreSyncGeneration;
  readonly carried: CarriedFirstUpdate | undefined;
  readonly committed: (
    result: Result,
  ) => DocumentCreateSeedResponse | undefined;
  readonly remoteDocumentId: string;
  readonly state: DocumentStoreState;
  readonly upload: () => Promise<Result>;
}): Promise<Result> {
  const { carried, state } = input;
  if (!carried) return input.upload();
  const requestRecord = state.record;
  const registeredIds: string[] = [];
  preRegisterMaterializedDocumentSyncUpdateIds(state, registeredIds, [
    carried.update.id,
  ]);
  const result = await cleanupPreRegisteredUpdateIdsOnFailure(
    state,
    registeredIds,
    input.upload,
  );
  const settled = await cleanupPreRegisteredUpdateIdsOnFailure(
    state,
    registeredIds,
    () =>
      settleCarriedFirstUpdate({
        attachmentGeneration: input.attachmentGeneration,
        carried,
        committed: input.committed(result),
        remoteDocumentId: input.remoteDocumentId,
        requestRecord,
        state,
      }),
  );
  if (!settled) discardPreRegisteredUpdateIds(state, registeredIds);
  return result;
}
