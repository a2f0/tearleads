import { isListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function listDocumentAttachments(
  request: RequestFn,
  documentId: string,
) {
  return request(
    `/documents/${pathSegment(documentId)}/attachments`,
    isListDocumentAttachmentsResponse,
    "GET",
  );
}
