import { listVersionVectorSpans } from "@tearleads/loro";
import { holdQueuedWritesFor } from "../localWriteQueue";
import type {
  DocumentState,
  DocumentStoreState,
  DocumentSyncAttempt,
} from "../state";

type PageUpdates = DocumentSyncAttempt["synced"]["decryptedUpdates"];

/**
 * Whether a page carries operations under the peer this document writes
 * with, past the ones the document holds. Another holder of the peer
 * committed them: a device that still has its own history is never served
 * its peer's operations ahead of itself.
 */
function pageExtendsOwnPeer(
  currentDoc: DocumentState,
  updates: PageUpdates,
): boolean {
  const ownPeer = currentDoc.peerIdStr;
  const held = currentDoc.oplogVersion().get(ownPeer) ?? 0;
  return updates.some((update) =>
    listVersionVectorSpans(update).some(
      (span) => span.peerId === ownPeer && span.endCounter > held,
    ),
  );
}

/**
 * Runs the save and live import of a page. A page that extends this
 * document's own peer runs behind every queued local write and holds the
 * write queue until it is applied: an edit that ran between the save and the
 * live import would write other operations at the ids the page carries, and
 * Loro refuses the import of an id it holds with other content. An edit that
 * already ran fails the page before its save, and the next judgement voids
 * the update that collides with it. The pass's Loro read window stays open
 * through the wait, so a process death there counts toward the page's
 * updates though no Loro work on them was running.
 */
export function applyingPage<T>(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  updates: PageUpdates,
  apply: () => Promise<T>,
): Promise<T> {
  return pageExtendsOwnPeer(currentDoc, updates)
    ? holdQueuedWritesFor(state, apply)
    : apply();
}
