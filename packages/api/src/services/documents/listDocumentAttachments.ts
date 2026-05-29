import type { ListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import {
  ListDocumentAttachmentsError,
  runListDocumentAttachmentsWorkflow,
} from "../../workflows/documents/listDocumentAttachments";
import type { ApiServiceRuntime } from "../runtime";

interface ListDocumentAttachmentsInput {
  documentId: string;
  userId: string;
}

export { ListDocumentAttachmentsError };

export async function listDocumentAttachments(
  runtime: ApiServiceRuntime,
  input: ListDocumentAttachmentsInput,
): Promise<ListDocumentAttachmentsResponse> {
  return runListDocumentAttachmentsWorkflow(runtime.db, input);
}
