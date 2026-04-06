import { isListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function listDocumentAttachments(
  request: RequestFn,
  documentId: string,
) {
  return request(
    `/documents/${documentId}/attachments`,
    isListDocumentAttachmentsResponse,
    "GET",
  );
}
