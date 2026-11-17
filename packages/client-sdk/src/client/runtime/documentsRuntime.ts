import { deleteDocumentPlacements } from "../../data/persistence/container-contents/documentContainerProjectionPersistence";
import {
  createDocumentsWorkflowRuntime as createRuntimeWithPlacementCleanup,
  type DocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
} from "../../workflows/documents";

type StandaloneDocumentsWorkflowRuntimeInput = Omit<
  DocumentsWorkflowRuntimeInput,
  "deleteDocumentPlacements"
>;

/** A standalone runtime, bound to Container Contents' placement cleanup. */
export function createDocumentsWorkflowRuntime(
  input: StandaloneDocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntime {
  return createRuntimeWithPlacementCleanup({
    ...input,
    deleteDocumentPlacements,
  });
}
