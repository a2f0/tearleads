import { createDocument } from "@symcrypt/loro";
import { getScopedPeerSeed } from "../../../data/crdtPeerSeed";
import { ensureDocumentAttachmentStructure } from "../../../data/documents/documentContent";
import { ensureDocumentRowsStructure } from "../../../data/documents/documentRowList";
import { DOCUMENTS_APP_KIND } from "../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "./state";

export async function createStoredDocument(
  state: DocumentStoreState,
): Promise<DocumentState> {
  // Scope the peer seed per pane so two panes editing the same document derive
  // distinct Loro peer ids (sharing one would corrupt the CRDT). A null
  // peerScope (single-pane) keeps the bare scope, so the device-stable peer is
  // unchanged for the common case.
  const peerScope = state.runtime.state.peerScope;
  const scope = peerScope
    ? `${DOCUMENTS_APP_KIND}:${peerScope}`
    : DOCUMENTS_APP_KIND;
  const createdDoc = await createDocument(await getScopedPeerSeed(scope));
  ensureDocumentAttachmentStructure(createdDoc);
  ensureDocumentRowsStructure(createdDoc);
  return createdDoc;
}
