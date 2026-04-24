import { isLinkDocumentToContainerResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function linkDocumentToContainer(
  request: RequestFn,
  documentId: string,
  containerId: string,
  expectedAccessStateHash: string,
) {
  return request(
    `/documents/${documentId}/link`,
    isLinkDocumentToContainerResponse,
    "POST",
    JSON.stringify({
      containerId,
      expectedAccessStateHash,
    }),
  );
}
