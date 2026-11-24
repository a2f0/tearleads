import type { DocumentPeerFrontier } from "@tearleads/validators/response";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";
import type { RemoteDocumentSyncPass } from "./remoteDocumentSyncPass";

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
 * Another user owns a peer the queued updates extend. Hand the refused peers
 * to the host's rebase and end the pass without a result: the rebase changes
 * the queue, and the host requests the pass that sends it. A rebase that finds
 * nothing to cut, or that fails, leaves the refusal terminal for this pass.
 */
export async function rebaseAfterPeerRefusal(
  sync: RemoteDocumentSyncPass,
  refusal: {
    readonly failure: DocumentSyncSubmitFailure;
    readonly peerFrontiers: readonly DocumentPeerFrontier[];
  },
): Promise<null> {
  const rebase = sync.rebaseOntoFreshPeer;
  if (!rebase) {
    await reportTerminalPeerRefusal(sync, refusal.failure);
    return null;
  }
  let result: Awaited<ReturnType<typeof rebase>>;
  try {
    result = await rebase(refusal.peerFrontiers);
  } catch (error) {
    await reportTerminalPeerRefusal(sync, refusal.failure);
    throw error;
  }
  if (result === "nothing_to_cut") {
    await reportTerminalPeerRefusal(sync, refusal.failure);
  }
  return null;
}
