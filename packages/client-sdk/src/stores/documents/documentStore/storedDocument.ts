import { createDocument, derivePeerId } from "@tearleads/loro";
import { ensureDocumentAttachmentStructure } from "../../../data/documents/documentContent";
import { ensureDocumentRowsStructure } from "../../../data/documents/documentRowList";
import { DOCUMENTS_APP_KIND } from "../../../workflows/documents";
import {
  getRuntimePeerSeed,
  recordPeerSeed,
} from "../../../workflows/sync/coordination";
import type { DocumentState, DocumentStoreState } from "./state";

async function createStoredDocumentWithSeed(
  peerSeed: string,
): Promise<DocumentState> {
  const createdDoc = await createDocument(peerSeed);
  ensureDocumentAttachmentStructure(createdDoc);
  ensureDocumentRowsStructure(createdDoc);
  return createdDoc;
}

async function storedDocumentPeerSeed(
  state: DocumentStoreState,
  peerSalt: string | undefined,
): Promise<string> {
  const peerScope = state.runtime.state.peerScope;
  const scope = peerScope
    ? `${DOCUMENTS_APP_KIND}:${peerScope}`
    : DOCUMENTS_APP_KIND;
  return recordPeerSeed({
    peerSalt,
    recordId: state.localId,
    runtimeSeed: await getRuntimePeerSeed(
      scope,
      state.runtime.state.domainScope,
    ),
    userId: state.runtime.auth.userId,
  });
}

/**
 * The record's own document under this writer's peer for it. Persistent pane
 * namespaces retain stable runtime seeds. Concurrent runtimes in one
 * namespace receive distinct memory-only seeds after the first owner, while
 * the usual single runtime can reuse its device seed after a page reload. The
 * peer is one per record and user (`recordPeerSeed`), so another member
 * cannot learn it from this writer's other documents before it first commits
 * here. Pass the record's `peerSalt`: after a peer rebase it names the fresh
 * peer the record moved to.
 */
export async function createStoredDocument(
  state: DocumentStoreState,
  peerSalt: string | undefined,
): Promise<DocumentState> {
  return createStoredDocumentWithSeed(
    await storedDocumentPeerSeed(state, peerSalt),
  );
}

/** The peer `createStoredDocument` writes on under `peerSalt`. */
export async function storedDocumentPeer(
  state: DocumentStoreState,
  peerSalt: string,
): Promise<`${number}`> {
  return derivePeerId(await storedDocumentPeerSeed(state, peerSalt));
}

/**
 * Rebuild after discarding non-durable local ops under a new peer. Reusing the
 * normal peer would reuse the discarded counters and corrupt the next edit.
 */
export function createFreshPeerStoredDocument(): Promise<DocumentState> {
  return createStoredDocumentWithSeed(crypto.randomUUID());
}
