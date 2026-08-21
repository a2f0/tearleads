import type { ListDocumentAttachmentsResponse } from "@symcrypt/validators/response";
import {
  ListDocumentAttachmentsError,
  runListDocumentAttachmentsWorkflow,
} from "../../workflows/documents/listDocumentAttachments";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

interface ListDocumentAttachmentsInput {
  documentId: string;
  userId: string;
}

export { ListDocumentAttachmentsError };

export const listDocumentAttachments = createDatabaseWorkflowService<
  ListDocumentAttachmentsInput,
  ListDocumentAttachmentsResponse
>(runListDocumentAttachmentsWorkflow);
