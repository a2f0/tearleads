import {
  createRemoteDocument,
  type DocumentRecord,
  resolveDocumentCreateAuthor,
} from "../../../workflows/documents";
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
    execSql: state.runtime.infra.execSql,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    return nextRecord;
  }

  state.runtime.util.log(`Created document: ${created.documentId}`);
  state.writerProjection = created.writerProjection;

  return (
    await persistDocument(state, currentDoc, {
      ...created.persistedState,
    })
  ).record;
}
