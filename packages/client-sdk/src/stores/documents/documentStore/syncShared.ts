import { deriveStableDocumentId } from "../../../data/documents/shared/stableDocumentId";
import {
  createRemoteDocument,
  type DocumentRecord,
  resolveDocumentCreateAuthor,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { persistDocument } from "./persistence";
import type {
  DocumentState,
  DocumentStoreState,
  EncapsulationKeyPair,
} from "./state";

export async function ensureRemoteDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord | null,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord | null> {
  if (nextRecord?.documentId) {
    return nextRecord;
  }

  if (!state.runtime.state.containerId) {
    state.runtime.util.log(
      "Documents: cannot create a remote document without a container.",
    );
    return nextRecord;
  }

  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(
      "Documents: skipped remote create because the writer context is unavailable.",
    );
    return nextRecord;
  }

  const created = await createRemoteDocument({
    apiClient: state.runtime.apiClient,
    author,
    containerId: state.runtime.state.containerId,
    // Derive the remote id from the stable local id so a retry after a lost
    // create response re-sends the same id and adopts the existing remote
    // document instead of creating a duplicate.
    documentId: await deriveStableDocumentId(state.localId),
    execSql: state.runtime.infra.execSql,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      state.runtime,
    ),
  });
  if (!created) {
    return nextRecord;
  }

  state.runtime.util.log(`Created document: ${created.documentId}`);
  state.writerProjection = created.writerProjection;

  // This persist is a remote-identity write (documentId + content keys), not a
  // content change. It runs after a network round trip, during which the user
  // may have kept typing into a brand-new note. The Loro doc is mutated
  // asynchronously on the write chain, so it can lag the optimistic snapshot;
  // re-deriving text/structured fields from the doc here would republish that
  // stale read over the live editor value and drop the just-typed characters
  // (the new-note "type immediately" race). Preserve the optimistic snapshot —
  // documentId/keys still propagate via state.record, independent of the
  // snapshot text — matching finalizeDocumentSync and the keystroke writes.
  return (
    await persistDocument(
      state,
      currentDoc,
      { ...created.persistedState },
      { preserveSnapshotStructuredFields: true, preserveSnapshotText: true },
    )
  ).record;
}
