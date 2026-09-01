import { encodeVersionVector } from "@tearleads/loro";
import {
  addDocumentRow,
  createDocumentRowId,
  type DocumentRowAttribution,
  removeDocumentRow,
  setDocumentRowFields,
} from "../../../data/documents/documentRowList";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { resolveDocumentCreateAuthor } from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import { ensureDocumentStoreReady } from "./initialization";
import { revalidateDocumentMutationIdentity } from "./mutationIdentityRevalidation";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import {
  canWriteDocument,
  type DocumentState,
  type DocumentStoreState,
} from "./state";
import {
  captureDocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

// Stamp each row write with the local signing identity (or "" when
// unauthenticated) and an ISO timestamp, matching the keys the edit-attribution
// layer resolves against.
function resolveRowAttribution(
  state: DocumentStoreState,
): DocumentRowAttribution {
  return {
    at: new Date().toISOString(),
    userId: resolveDocumentCreateAuthor(state.runtime)?.signerUserId ?? "",
  };
}

async function persistRowMutation(
  state: DocumentStoreState,
  expectedLocalWriteGeneration: number,
  mutate: (doc: DocumentState) => boolean,
): Promise<void> {
  if (state.localWriteGeneration !== expectedLocalWriteGeneration) {
    return;
  }
  const currentDoc = state.doc;
  if (!currentDoc || !canWriteDocument(state)) {
    return;
  }
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    return;
  }

  if (!mutate(currentDoc)) {
    await revalidateDocumentMutationIdentity({ currentDoc, generation, state });
    return;
  }

  const update = pendingDeltaSinceBase(state, currentDoc);
  if (update.byteLength === 0) {
    await revalidateDocumentMutationIdentity({ currentDoc, generation, state });
    return;
  }
  // Captured at delta time: the enqueued row proves coverage up to exactly
  // this version, so it is the frontier the persist below may publish.
  const coveredVersion = encodeVersionVector(currentDoc);

  const pendingUpdate = createPendingUpdateFields(update);
  if (!pendingUpdate) {
    await revalidateDocumentMutationIdentity({ currentDoc, generation, state });
    return;
  }
  // Row writes change neither prose nor structured fields; setReadySnapshot
  // always re-derives rows from the doc, so preserve the text/structured fields
  // in case this write overlaps an in-flight keystroke elsewhere.
  const persisted = await persistDocument(
    state,
    currentDoc,
    { snapshotEndVersion: coveredVersion },
    {
      pendingUpdate,
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
    generation,
  );
  if (
    !persisted ||
    persisted.pullContinuationSuperseded ||
    persisted.syncIdentitySuperseded ||
    !isDocumentStoreSyncGenerationCurrent(state, generation)
  ) {
    // Refused: the document was deleted while this persist was queued
    // and the store is cleared — no state advance, no sync request.
    return;
  }
  advancePendingBaseVersion(state, currentDoc);
  requestDocumentStoreSync(state);
}

function queueRowMutation(
  state: DocumentStoreState,
  mutate: (doc: DocumentState) => boolean,
): Promise<void> {
  const writeGeneration = state.localWriteGeneration;
  // Unlike text/structured-field writes, row writes intentionally do NOT bump
  // `state.pendingLocalWrites`: rows are never in the optimistic-preserve set —
  // `setReadySnapshot` always re-derives them from the doc — so there is no
  // optimistic snapshot for a concurrent sync pass to clobber. Input smoothness
  // during rapid edits is handled in the app layer (useDocumentRowEditing).
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistRowMutation(state, writeGeneration, mutate))
    .catch((error: unknown) => {
      console.error("Failed to persist document row changes:", error);
    });
  return state.writeChain;
}

export async function addRowToDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
  fields: Readonly<Record<string, string>>,
): Promise<string> {
  const id = createDocumentRowId();
  let ready: boolean;
  try {
    ready = await ensureDocumentStoreReady(state, scheduleSync);
  } catch (error) {
    console.error("Failed to add document row:", error);
    return id;
  }

  if (!ready || !state.doc || !canWriteDocument(state)) {
    return id;
  }

  await queueRowMutation(state, (doc) => {
    addDocumentRow(doc, id, fields, resolveRowAttribution(state));
    return true;
  });
  return id;
}

export async function updateRowInDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
  id: string,
  patch: Readonly<Record<string, string>>,
): Promise<void> {
  let ready: boolean;
  try {
    ready = await ensureDocumentStoreReady(state, scheduleSync);
  } catch (error) {
    console.error("Failed to update document row:", error);
    return;
  }

  if (!ready || !state.doc || !canWriteDocument(state)) {
    return;
  }

  await queueRowMutation(state, (doc) =>
    setDocumentRowFields(doc, id, patch, resolveRowAttribution(state)),
  );
}

export async function removeRowFromDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
  id: string,
): Promise<void> {
  let ready: boolean;
  try {
    ready = await ensureDocumentStoreReady(state, scheduleSync);
  } catch (error) {
    console.error("Failed to remove document row:", error);
    return;
  }

  if (!ready || !state.doc || !canWriteDocument(state)) {
    return;
  }

  await queueRowMutation(state, (doc) => removeDocumentRow(doc, id));
}
