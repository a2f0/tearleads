import type { DocumentSummary } from "../../data/documents/documentSummary";
import type { RemoteDocumentPersistedState } from "./documentLinks";
import type {
  DocumentStructuralMutationHost,
  DocumentStructuralMutationLocalStore,
  DocumentStructuralMutationRuntime,
} from "./documentStructureTypes";

export async function relinkContainerDocumentLocally<TRuntime>(params: {
  accessEpoch: number;
  accessStateHash?: string | null | undefined;
  currentDocumentStore: DocumentStructuralMutationLocalStore<TRuntime>;
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  remoteState?: RemoteDocumentPersistedState | undefined;
  requestSync: boolean;
  runtime: DocumentStructuralMutationRuntime;
  targetContainerId: string;
}) {
  const {
    accessEpoch,
    accessStateHash,
    currentDocumentStore,
    host,
    note,
    remoteState,
    requestSync,
    runtime,
    targetContainerId,
  } = params;

  const relinkedNote = await currentDocumentStore.relink({
    accessEpoch,
    ...(accessStateHash === undefined ? {} : { accessStateHash }),
    containerId: targetContainerId,
    ...remoteState,
    documentId: note.documentId,
    localId: note.id,
  });
  if (!relinkedNote) {
    runtime.util.log(
      `Container contents: note ${note.id} could not be relinked after a structural mutation`,
    );
    return null;
  }

  host.mergeDocumentSummary(relinkedNote);
  currentDocumentStore.updateRuntime(
    host.documentWorkflowRuntime(targetContainerId),
  );
  if (requestSync) {
    currentDocumentStore.requestSync();
  }
  return relinkedNote;
}
