import { createDocument } from "@tearleads/loro";
import { getRuntimePeerSeed } from "../../../data/crdtPeerSeed";
import { ensureDocumentAttachmentStructure } from "../../../data/documents/documentContent";
import { ensureDocumentRowsStructure } from "../../../data/documents/documentRowList";
import { DOCUMENTS_APP_KIND } from "../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "./state";

async function createStoredDocumentWithSeed(
  peerSeed: string,
): Promise<DocumentState> {
  const createdDoc = await createDocument(peerSeed);
  ensureDocumentAttachmentStructure(createdDoc);
  ensureDocumentRowsStructure(createdDoc);
  return createdDoc;
}

export async function createStoredDocument(
  state: DocumentStoreState,
): Promise<DocumentState> {
  // Persistent pane namespaces retain stable seeds. Concurrent runtimes in one
  // namespace receive distinct memory-only seeds after the first owner, while
  // the usual single runtime can reuse its device seed after a page reload.
  const peerScope = state.runtime.state.peerScope;
  const scope = peerScope
    ? `${DOCUMENTS_APP_KIND}:${peerScope}`
    : DOCUMENTS_APP_KIND;
  return createStoredDocumentWithSeed(
    await getRuntimePeerSeed(scope, state.runtime.state.domainScope),
  );
}

/**
 * Rebuild after discarding non-durable local ops under a new peer. Reusing the
 * normal peer would reuse the discarded counters and corrupt the next edit.
 */
export function createFreshPeerStoredDocument(): Promise<DocumentState> {
  return createStoredDocumentWithSeed(crypto.randomUUID());
}
