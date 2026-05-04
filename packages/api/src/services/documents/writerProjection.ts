import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  DocumentWriterProjectionError,
  runDocumentWriterProjectionWorkflow,
} from "../../workflows/documents/writerProjection";
import type { ApiServiceRuntime } from "../runtime";

export { DocumentWriterProjectionError };

export async function getDocumentWriterProjection(
  runtime: ApiServiceRuntime,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<DocumentWriterProjectionResponse> {
  return runDocumentWriterProjectionWorkflow(runtime.db, input);
}
