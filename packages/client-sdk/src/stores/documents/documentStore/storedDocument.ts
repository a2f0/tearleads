import { createDocument } from "@tearleads/loro";
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

/**
 * The record's own document under this writer's peer for it. Persistent pane
 * namespaces retain stable runtime seeds. Concurrent runtimes in one
 * namespace receive distinct memory-only seeds after the first owner, while
 * the usual single runtime can reuse its device seed after a page reload. The
 * peer is one per record and user (`recordPeerSeed`), so another member
 * cannot learn it from this writer's other documents before it first commits
 * here.
 */
export async function createStoredDocument(
  state: DocumentStoreState,
): Promise<DocumentState> {
  const peerScope = state.runtime.state.peerScope;
  const scope = peerScope
    ? `${DOCUMENTS_APP_KIND}:${peerScope}`
    : DOCUMENTS_APP_KIND;
  return createStoredDocumentWithSeed(
    recordPeerSeed({
      recordId: state.localId,
      runtimeSeed: await getRuntimePeerSeed(
        scope,
        state.runtime.state.domainScope,
      ),
      userId: state.runtime.auth.userId,
    }),
  );
}

/**
 * Rebuild after discarding non-durable local ops under a new peer. Reusing the
 * normal peer would reuse the discarded counters and corrupt the next edit.
 */
export function createFreshPeerStoredDocument(): Promise<DocumentState> {
  return createStoredDocumentWithSeed(crypto.randomUUID());
}
