import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import {
  DocumentEditAttributionError,
  runDocumentEditAttributionWorkflow,
} from "../../workflows/documents/documentEditAttribution";
import type { ApiServiceRuntime } from "../runtime";

interface DocumentEditAttributionInput {
  documentId: string;
  userId: string;
}

export { DocumentEditAttributionError };

export async function documentEditAttribution(
  runtime: ApiServiceRuntime,
  input: DocumentEditAttributionInput,
): Promise<DocumentEditAttributionResponse> {
  return runDocumentEditAttributionWorkflow(runtime.db, input);
}
