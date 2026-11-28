import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import type { PeerRefusal } from "../../../data/documents/shared/sync/peerRefusalRecovery";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";
import type { PendingUpdateFields } from "../../../data/persistence/documents/records";
import type {
  DocumentPeerRebaseOutcome,
  RemoteDocumentSyncPass,
} from "./remoteDocumentSyncPass";

/**
 * The code reported through `onTerminalSubmitFailure` when a document's writes
 * are parked waiting for another user's device (or the organization owner) to
 * restore pre-purge history (#3263).
 */
export const DOCUMENT_PEER_RESTORE_AWAITS_OWNER_ERROR_CODE =
  "document_peer_restore_awaits_owner";

/** The abandon reason of a pass parked until a peer's owner restores it. */
const PEER_RESTORE_AWAITS_OWNER = "peer-restore-awaits-owner";

/** The abandon reason when the queue already starts at every regressed frontier. */
const PEER_RELAY_ALREADY_QUEUED = "peer-relay-already-queued";

/**
 * Whether a recovery left a queue a new pass must send: it replaced the
 * queue, or lost a race to a change that did. A park, and a refusal with
 * nothing to cut or relay, leave the queue the server just refused, so asking
 * for another pass would only draw the same refusal.
 */
export function peerRebaseChangedQueue(
  outcome: DocumentPeerRebaseOutcome,
): boolean {
  switch (outcome) {
    case "rebased":
    case "relayed":
    case "superseded":
      return true;
    case "nothing_to_cut":
    case "nothing_to_relay":
    case "parked":
      return false;
  }
}

/**
 * What a rebase or a relay hands its install: the ordered update segments it
 * queues, and what the device knew was committed, which the install records.
 */
export function queuedRecoveryUpdates(recovery: {
  readonly committedVersion: string;
  readonly updates: readonly Uint8Array[];
}): {
  readonly committedVersion: string;
  readonly pendingUpdates: PendingUpdateFields[];
} {
  const pendingUpdates = recovery.updates.flatMap((update) => {
    const fields = createPendingUpdateFields(update);
    return fields ? [fields] : [];
  });
  if (pendingUpdates.length === 0) {
    throw new Error("Peer recovery produced no update to send");
  }
  return { committedVersion: recovery.committedVersion, pendingUpdates };
}

async function reportTerminalPeerRefusal(
  sync: RemoteDocumentSyncPass,
  failure: DocumentSyncSubmitFailure,
): Promise<void> {
  if (sync.stillCurrent?.() === false) return;
  failure.report();
  await sync.onTerminalSubmitFailure?.(failure);
  sync.onSyncAbandoned?.("the sync submit failed terminally");
}

/**
 * The server lost committed operations on a peer another user owns, so this
 * device may not send them again and must not write them under a fresh peer.
 * The writes stay queued while pull-only passes keep remote reads live. The
 * durable row tells the write queue why, as it does for an ancestor repair
 * this writer cannot make; nothing is reported as an error. Once a device of
 * the peer's owner restores those operations, or the organization owner
 * enables member restoration, the writes resume and clear the row.
 */
async function parkUntilOwnerRestores(
  sync: RemoteDocumentSyncPass,
): Promise<void> {
  if (sync.stillCurrent?.() === false) return;
  await sync.onTerminalSubmitFailure?.({
    code: DOCUMENT_PEER_RESTORE_AWAITS_OWNER_ERROR_CODE,
    message:
      "The server lost committed history on a writer another user now owns; queued changes sync after that user's device restores it",
    ok: false,
    report: () => undefined,
    status: null,
  });
  sync.onSyncAbandoned?.(PEER_RESTORE_AWAITS_OWNER);
}

/**
 * Another user owns a peer the queued updates extend, or they depend on an
 * operation nobody committed. Hand the refusal to the host's recovery and
 * end the pass without a result: a rebase or a relay changes the queue, and
 * the host requests the pass that sends it. A recovery that parks reports
 * the wait and leaves the queue. One that finds `nothing_to_relay` leaves no
 * terminal failure row because the queue already starts at every regressed
 * frontier. One that finds nothing to cut, or that fails, leaves the server's
 * own refusal terminal for this pass; a failure is rethrown.
 */
export async function rebaseAfterPeerRefusal(
  sync: RemoteDocumentSyncPass,
  request: {
    readonly failure: DocumentSyncSubmitFailure;
    readonly refusal: PeerRefusal;
  },
): Promise<null> {
  const rebase = sync.rebaseOntoFreshPeer;
  if (!rebase) {
    await reportTerminalPeerRefusal(sync, request.failure);
    return null;
  }
  let outcome: Awaited<ReturnType<typeof rebase>>;
  try {
    outcome = await rebase(request.refusal);
  } catch (error) {
    await reportTerminalPeerRefusal(sync, request.failure);
    throw error;
  }
  switch (outcome) {
    case "nothing_to_cut":
      await reportTerminalPeerRefusal(sync, request.failure);
      return null;
    case "nothing_to_relay":
      if (sync.stillCurrent?.() !== false) {
        sync.onSyncAbandoned?.(PEER_RELAY_ALREADY_QUEUED);
      }
      return null;
    case "parked":
      await parkUntilOwnerRestores(sync);
      return null;
    case "rebased":
    case "relayed":
    case "superseded":
      return null;
  }
}
