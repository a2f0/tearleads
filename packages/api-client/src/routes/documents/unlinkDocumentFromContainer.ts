import { isUnlinkDocumentFromContainerResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function unlinkDocumentFromContainer(
  request: RequestFn,
  documentId: string,
  containerId: string,
) {
  return request(
    `/documents/${documentId}/unlink`,
    isUnlinkDocumentFromContainerResponse,
    "POST",
    JSON.stringify({ containerId }),
  );
}
