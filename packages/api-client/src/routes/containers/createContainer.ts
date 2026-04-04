import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import { isCreateContainerResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function createContainer(
  request: RequestFn,
  id: string,
  parentId: string,
  initialMetadataUpdates: SyncDocumentOutgoingUpdate[],
) {
  return request(
    "/containers",
    isCreateContainerResponse,
    "POST",
    JSON.stringify({ id, parentId, initialMetadataUpdates }),
  );
}
