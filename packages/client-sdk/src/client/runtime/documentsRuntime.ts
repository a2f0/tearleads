import { deleteDocumentPlacements } from "../../data/persistence/container-contents/documentContainerProjectionPersistence";
import {
  createDocumentsWorkflowRuntime as createRuntimeWithPlacementCleanup,
  type DocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput as DocumentsWorkflowRuntimeHostInput,
} from "../../workflows/documents";

/** A standalone host's input; the runtime binds placement cleanup itself. */
export type DocumentsWorkflowRuntimeInput = Omit<
  DocumentsWorkflowRuntimeHostInput,
  "deleteDocumentPlacements"
>;

/** A standalone runtime, bound to Container Contents' placement cleanup. */
export function createDocumentsWorkflowRuntime(
  input: DocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntime {
  return createRuntimeWithPlacementCleanup({
    ...input,
    deleteDocumentPlacements,
  });
}
