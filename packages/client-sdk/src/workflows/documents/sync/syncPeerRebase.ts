import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import type { PeerRefusal } from "../../../data/documents/shared/sync/peerRefusalRecovery";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";
import type { PendingUpdateFields } from "../../../data/persistence/documents/records";
import type {
  DocumentPeerRebaseOutcome,
  RemoteDocumentSyncPass,
} from "./remoteDocumentSyncPass";

/** The abandon reason of a pass parked until a peer's owner restores it. */
const PEER_RESTORE_AWAITS_OWNER = "peer-restore-awaits-owner";

/**
 * Whether a recovery left a queue a new pass must send: it replaced the
 * queue, or lost a race to a change that did. A park, and a refusal with
 * nothing to cut, leave the queue the server just refused, so asking for
 * another pass would only draw the same refusal.
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
    case "parked":
      return false;
  }
}

/**
 * The one queued update a rebase or a relay installs, with the version the
 * device knows is committed while the update starts below it.
 */
export function queuedRecoveryUpdate(recovery: {
  readonly committedVersionVector: string | null;
  readonly update: Uint8Array;
}): PendingUpdateFields {
  const fields = createPendingUpdateFields(recovery.update);
  if (!fields) throw new Error("Peer recovery produced no update to send");
  return recovery.committedVersionVector === null
    ? fields
    : { ...fields, committedVersionVector: recovery.committedVersionVector };
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
 * The server lost committed operations on a peer another user now owns, so
 * this device may not send them again and must not write them under a fresh
 * peer. The writes stay queued and the document stays readable and editable.
 * The durable row tells the write queue why, as it does for an ancestor
 * repair this writer cannot make; nothing is reported as an error. Every
 * later pass submits the queue again, and the first one after a device of
 * the peer's owner restores those operations recovers and clears the row.
 * After a recovery that owner is normally the organization's, whose seed
 * claimed the peer.
 */
async function parkUntilOwnerRestores(
  sync: RemoteDocumentSyncPass,
): Promise<void> {
  if (sync.stillCurrent?.() === false) return;
  await sync.onTerminalSubmitFailure?.({
    code: "document_peer_restore_awaits_owner",
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
 * the wait and leaves the queue. One that finds nothing to cut, or that
 * fails, leaves the refusal terminal for this pass; a failure is rethrown.
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
    case "parked":
      await parkUntilOwnerRestores(sync);
      return null;
    case "rebased":
    case "relayed":
    case "superseded":
      return null;
  }
}
