/**
 * Whether a container listing vouches for this store's document, so the store
 * arms no probe of its own when its record loads or its socket reconnects.
 *
 * A listing covers a store when the scope lists the store's container after
 * every acknowledged connection (`getOrCreateDocumentListingCoverage`), the
 * record has completed a pull, and nothing still obliges a read: no read a
 * listing owes (`document_listing_revalidations`), no processed cursor the
 * next pull would withhold, no pull to continue, no attachment whose bytes
 * are missing, and no hint that named the document before the record loaded.
 * An uncovered store probes as every opened store did before listings owed
 * reads.
 */

import {
  type DocumentListingRevalidation,
  type DocumentRecord,
  findOwedDocumentListingRead,
  isDocumentProcessedCursorWithheld,
  settleCoveredDocumentListingRead,
} from "../../../../workflows/documents";
import { getOrCreateDocumentListingCoverage } from "../../listingCoverage";
import { awaitsAttachmentCopy } from "../attachments/attachmentHydration";
import type { DocumentStoreState } from "../state";
import {
  type OwedListingReadEvent,
  type OwedListingReadState,
  transitionOwedListingRead,
} from "./owedListingReadMachine";
import {
  allowDocumentStoreRemoteSync,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";
import { hasPersistedRemoteDocumentSyncState } from "./syncShared";

/** One later pull for a read a lagging replica answered without the edit. */
const BEHIND_LISTING_RETRY_DELAY_MS = 2_000;

/** Each store's owed-read state; a store with no entry knows of no debt. */
const owedReadStates = new WeakMap<DocumentStoreState, OwedListingReadState>();

/** Applies `event`; returns the store's owed-read state before and after. */
function applyOwedReadEvent(
  state: DocumentStoreState,
  event: OwedListingReadEvent,
) {
  const previous = owedReadStates.get(state) ?? null;
  const next = transitionOwedListingRead(previous, event);
  if (next) owedReadStates.set(state, next);
  else owedReadStates.delete(state);
  return { next, previous };
}

function coverage(state: DocumentStoreState) {
  return getOrCreateDocumentListingCoverage(state.runtime.state.domainScope);
}

/** Remembers the update hints the store's runtime has delivered so far. */
export function observeDocumentListingHints(state: DocumentStoreState): void {
  coverage(state).observeEvents(state.runtime.state.events);
}

/** Whether a listing covers the loaded store's document; see the module. */
export function isDocumentStoreCoveredByListing(
  state: DocumentStoreState,
): boolean {
  const record = state.record;
  return (
    record !== null &&
    record.documentId !== null &&
    hasPersistedRemoteDocumentSyncState(record) &&
    state.pullContinuation === null &&
    !record.pullContinuationRecoveryRequired &&
    !owedReadStates.has(state) &&
    // Attachment bytes download after a sync response, so a copy still to
    // fetch or repair needs the pull a probe makes.
    !awaitsAttachmentCopy(state) &&
    // The lane that lists the document is its own container's, which is not
    // always the container the store was opened under.
    coverage(state).coversContainer(record.containerId)
  );
}

/**
 * Reads what a loading store's document is owed, before its startup probe is
 * decided: the durable debt a listing left, and whether a hint named the
 * document before this record could read hints. Returns whether a listing
 * covers the load. `isCurrent` reports a load that was superseded meanwhile.
 */
export async function loadDocumentListingCoverage(
  state: DocumentStoreState,
  record: DocumentRecord,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (record.documentId === null) {
    applyOwedReadEvent(state, { read: null, type: "observed" });
    return false;
  }
  const { execSql } = state.runtime.infra;
  const owed = await findOwedDocumentListingRead(execSql, {
    documentId: record.documentId,
    localId: state.localId,
  });
  if (!isCurrent()) return false;
  applyOwedReadEvent(state, { read: owed, type: "observed" });
  // A listing owes a read only to a row it is served. A record whose cursor
  // stopped counting since its last pull owes one no listing will ask for.
  // The load reads the cursor as it stands, so a store reset and reloaded
  // over a cursor its next pull would send again is no longer withheld. A
  // record with no completed pull is not covered whatever its cursor says.
  if (owed === null && hasPersistedRemoteDocumentSyncState(record)) {
    const withheld = await isDocumentProcessedCursorWithheld(execSql, {
      documentId: record.documentId,
      frontier: record.snapshotEndVersion,
      localId: state.localId,
    });
    if (!isCurrent()) return false;
    applyOwedReadEvent(state, { type: "cursorRead", withheld });
  }
  observeDocumentListingHints(state);
  const hinted = coverage(state).takeHint(record.documentId);
  return !hinted && isDocumentStoreCoveredByListing(state);
}

/**
 * The debt a pull is about to answer, read before its request so a newer
 * request made meanwhile survives. Only a remote probe or a store that
 * already knows of a debt reads it: a listing that owes a read asks the
 * registered store to probe.
 */
export async function findOwedListingReadBeforePull(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  input: { readonly documentId: string; readonly remoteProbe: boolean },
): Promise<DocumentListingRevalidation | null> {
  if (!input.remoteProbe && !owedReadStates.has(state)) return null;
  const owed = await findOwedDocumentListingRead(generation.execSql, {
    documentId: input.documentId,
    localId: state.localId,
  });
  // A pass that was superseded while it read says nothing about the store.
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return owed;
  applyOwedReadEvent(state, { read: owed, type: "observed" });
  return owed;
}

/**
 * Settles the debt `owed` once the pull that followed it has finalized, if
 * that pull reached its bound and its pass is still current.
 */
export async function settleOwedListingReadAfterCompletedPull(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  input: {
    readonly frontier: string;
    readonly owed: DocumentListingRevalidation | null;
    readonly pull: {
      readonly hasHeldPull: boolean;
      readonly hasIncompletePull: boolean;
    };
  },
): Promise<void> {
  if (
    input.pull.hasIncompletePull ||
    input.pull.hasHeldPull ||
    !isDocumentStoreSyncGenerationCurrent(state, generation)
  ) {
    return;
  }
  await settleWithheldCursorAfterPull(state, generation, input.frontier);
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return;
  if (input.owed === null) return;
  await settleOwedListingReadAfterPull(state, generation, input.owed);
}

/**
 * Ends a store's withheld-cursor state once a pull that reached its bound has
 * left a cursor the next pull would send. The cursor on disk decides, not
 * the pull: one whose pages ran under more than one judge, or that the
 * server answered with no bound, completes and leaves the old cursor.
 */
async function settleWithheldCursorAfterPull(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  frontier: string,
): Promise<void> {
  const documentId = state.record?.documentId;
  if (owedReadStates.get(state)?.status !== "withheld" || !documentId) return;
  const withheld = await isDocumentProcessedCursorWithheld(generation.execSql, {
    documentId,
    frontier,
    localId: state.localId,
  });
  if (withheld || !isDocumentStoreSyncGenerationCurrent(state, generation)) {
    return;
  }
  applyOwedReadEvent(state, { type: "cursorRead", withheld: false });
}

/**
 * Settles the debt a completed pull observed, once the record pays it: the
 * processed cursor the pull saved covers the count the listing advertised,
 * and the manifest it saved is the head the listing showed or a later one.
 * A replica that lags the listing can answer without the edit or the head:
 * the debt then stays, the store asks for one later pull, and until it
 * settles no listing covers the store.
 */
async function settleOwedListingReadAfterPull(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  owed: DocumentListingRevalidation,
): Promise<void> {
  const settled = await settleCoveredDocumentListingRead(
    generation.execSql,
    owed,
  );
  // A superseded pass leaves the store's own state to the pass after it,
  // which reads the debt again.
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return;
  if (settled) {
    applyOwedReadEvent(state, { read: owed, type: "paid" });
    return;
  }
  const { next, previous } = applyOwedReadEvent(state, {
    read: owed,
    type: "unpaid",
  });
  // One later pull per debt revision; a renewed debt's listing asked for
  // its own.
  if (next === previous) return;
  allowDocumentStoreRemoteSync(state);
  markDocumentStoreRemoteSyncPending(state, "independent");
  state.syncLane?.requestSyncAfter(BEHIND_LISTING_RETRY_DELAY_MS);
}
