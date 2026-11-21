import { getDocumentAttachments } from "../../../../data/documents/documentContent";
import {
  attachmentContentSha256,
  type BlobStore,
} from "../../../../workflows/blobs";
import { requestDocumentStoreSync } from "../../registry";
import { type DocumentStoreState, setReadySnapshot } from "../state";
import {
  allowDocumentStoreRemoteSync,
  captureDocumentStoreGenerationIdentity,
  isDocumentStoreGenerationIdentityCurrent,
  markDocumentStoreRemoteSyncPending,
} from "../sync/syncGeneration";
import type {
  HeldCopy,
  HeldCopyUnavailableReason,
} from "./heldCopyCheckMachine";
import {
  dispatchHeldCopyCheck,
  heldCopyChecksRequested,
  heldCopyOf,
  requestHeldCopyChecks,
} from "./heldCopyChecks";

let lastAttempt = 0;

/** A host opened the document: check its held copies once it is ready. */
export async function checkHeldAttachmentCopies(
  state: DocumentStoreState,
  ensureReady: () => Promise<boolean>,
): Promise<void> {
  requestHeldCopyChecks(state);
  // A store that fails to load reports that to its own readers; a reload
  // runs the requested checks.
  const ready = await ensureReady().catch(() => false);
  if (ready) await runHeldCopyChecks(state);
}

/**
 * Read each held copy the open document records once per store session, on
 * first access rather than in a library-wide scan. A missing file, or bytes
 * whose digest differs from the row's, marks the slot `unavailable` and asks
 * the server again; hydration then verifies the download against the
 * document's digest before the copy is held again. Runs only after a host
 * requested checks for this store, and again when the store reloads.
 */
export async function runHeldCopyChecks(
  state: DocumentStoreState,
): Promise<void> {
  const currentDoc = state.doc;
  if (!heldCopyChecksRequested(state) || !currentDoc || state.relinkedElsewhere)
    return;
  const identity = captureDocumentStoreGenerationIdentity(state);
  const uploading = new Set(state.pendingAttachments.map((row) => row.slotId));
  const started = getDocumentAttachments(currentDoc).flatMap(({ slotId }) => {
    const copy = heldCopyOf(state, slotId);
    // Only a bound copy can be fetched again; a queued upload owns its bytes.
    if (
      !copy ||
      !state.attachmentBlobIdBySlotId[slotId] ||
      uploading.has(slotId)
    )
      return [];
    lastAttempt += 1;
    const attempt = lastAttempt;
    const check = dispatchHeldCopyCheck(state, slotId, {
      type: "checkStarted",
      attempt,
      copy,
    });
    return check?.status === "checking" && check.attempt === attempt
      ? [{ attempt, copy, slotId }]
      : [];
  });
  let flagged = false;
  for (const [index, { attempt, copy, slotId }] of started.entries()) {
    const result = await readHeldCopy(identity.blobStore, copy);
    // A reset or runtime swap retires this pass: its reads settle nothing.
    if (!isDocumentStoreGenerationIdentityCurrent(state, identity)) {
      for (const retired of started.slice(index))
        dispatchHeldCopyCheck(state, retired.slotId, {
          type: "checkAbandoned",
          attempt: retired.attempt,
        });
      return;
    }
    const settled = dispatchHeldCopyCheck(
      state,
      slotId,
      result === "unreadable"
        ? { type: "checkAbandoned", attempt }
        : { type: "checkFinished", attempt, result },
    );
    if (settled?.status === "unavailable") flagged = true;
  }
  if (flagged && !state.relinkedElsewhere) publishUnavailableCopies(state);
}

async function readHeldCopy(
  blobStore: BlobStore,
  copy: HeldCopy,
): Promise<"present" | "unreadable" | HeldCopyUnavailableReason> {
  try {
    const source = await blobStore.openByteSource(copy.storageKey);
    if (!source) return "missing";
    const contentSha256 = await attachmentContentSha256(source);
    return contentSha256 === copy.contentSha256 ? "present" : "damaged";
  } catch {
    // Only an absent file or differing bytes are evidence. A failed read (a
    // released database, a locked key) leaves the copy unchecked.
    return "unreadable";
  }
}

function publishUnavailableCopies(state: DocumentStoreState): void {
  const currentDoc = state.doc;
  if (!currentDoc || !state.snapshot.ready) return;
  setReadySnapshot(
    state,
    currentDoc,
    state.snapshot.syncing,
    state.snapshot.text,
    state.snapshot.structuredFields,
  );
  if (!state.record?.documentId) return;
  // A fresh remote signal makes the next pass list bindings again.
  allowDocumentStoreRemoteSync(state);
  markDocumentStoreRemoteSyncPending(state, "independent");
  requestDocumentStoreSync(state);
}
