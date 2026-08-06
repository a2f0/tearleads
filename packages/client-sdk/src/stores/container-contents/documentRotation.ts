import type { DocumentSummary } from "../../data/documents/documentSummary";
import {
  type ContainerContentsWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
} from "../../workflows/container-contents/runtime";
import { openDocumentStore } from "../documents";

export async function prepareContainerDocumentRotationSnapshot(
  runtime: ContainerContentsWorkflowRuntime,
  document: DocumentSummary,
): Promise<Uint8Array | null> {
  if (!document.documentId || !document.containerId) {
    return null;
  }
  const store = openDocumentStore(
    runtime.state.domainScope,
    document.id,
    createContainerContentsDocumentsRuntime(runtime, document.containerId),
    document.documentId,
  );
  if (!(await store.ensureInitialized())) {
    return null;
  }
  return store.assertCanRotateContentKey();
}
