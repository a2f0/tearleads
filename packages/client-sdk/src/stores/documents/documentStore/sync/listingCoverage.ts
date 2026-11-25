/**
 * Whether a container listing vouches for this store's document, so the store
 * arms no probe of its own when its record loads or its socket reconnects.
 *
 * A listing covers a store when the scope lists the store's container after
 * every acknowledged connection (`getOrCreateDocumentListingCoverage`), the
 * record has completed a pull, and nothing still obliges a read: no read a
 * listing owes (`document_listing_revalidations`), no pull to continue, no
 * attachment whose bytes are missing, and no hint that named the document
 * before the record loaded. An uncovered store probes as every opened store
 * did before listings owed reads.
 */

import {
  type DocumentListingRevalidation,
  type DocumentRecord,
  findOwedDocumentListingRead,
  settleCoveredDocumentListingRead,
} from "../../../../workflows/documents";
import { getOrCreateDocumentListingCoverage } from "../../listingCoverage";
import { awaitsAttachmentCopy } from "../attachments/attachmentHydration";
import type { DocumentStoreState } from "../state";
import {
  allowDocumentStoreRemoteSync,
  type DocumentStoreSyncGeneration,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";
import { hasPersistedRemoteDocumentSyncState } from "./syncShared";

/** One later pull for a read a lagging replica answered without the edit. */
const BEHIND_LISTING_RETRY_DELAY_MS = 2_000;

/** The read a listing owes each store's document, as the store last saw it. */
const owedReads = new WeakMap<
  DocumentStoreState,
  DocumentListingRevalidation
>();
/** The debt revision each store already retried once. */
const retriedRevisions = new WeakMap<DocumentStoreState, string>();

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
    !owedReads.has(state) &&
    // Attachment bytes download after a sync response, so a copy still to
    // fetch or repair needs the pull a probe makes.
    !awaitsAttachmentCopy(state) &&
    coverage(state).coversContainer(state.runtime.state.containerId)
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
    owedReads.delete(state);
    return false;
  }
  const owed = await findOwedDocumentListingRead(
    state.runtime.infra.execSql,
    record.documentId,
  );
  if (!isCurrent()) return false;
  if (owed) owedReads.set(state, owed);
  else owedReads.delete(state);
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
  if (!input.remoteProbe && !owedReads.has(state)) return null;
  const owed = await findOwedDocumentListingRead(
    generation.execSql,
    input.documentId,
  );
  if (owed) owedReads.set(state, owed);
  else owedReads.delete(state);
  return owed;
}

/**
 * Settles the debt a completed pull observed, once the processed cursor the
 * pull saved covers the count the listing advertised. A replica that lags the
 * listing can answer without the edit: the debt then stays, the store asks
 * for one later pull, and until it settles no listing covers the store.
 */
export async function settleOwedListingReadAfterPull(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  input: {
    readonly frontier: string;
    readonly owed: DocumentListingRevalidation;
  },
): Promise<void> {
  const settled = await settleCoveredDocumentListingRead(generation.execSql, {
    frontier: input.frontier,
    localId: state.localId,
    owed: input.owed,
  });
  if (settled) {
    if (owedReads.get(state)?.revision === input.owed.revision) {
      owedReads.delete(state);
    }
    return;
  }
  if (retriedRevisions.get(state) === input.owed.revision) return;
  retriedRevisions.set(state, input.owed.revision);
  allowDocumentStoreRemoteSync(state);
  markDocumentStoreRemoteSyncPending(state, "independent");
  state.syncLane?.requestSyncAfter(BEHIND_LISTING_RETRY_DELAY_MS);
}
