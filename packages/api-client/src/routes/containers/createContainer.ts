import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import { isCreateContainerResponse } from "@tearleads/validators/response";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import type { RequestFn } from "../../types";

export function createContainer(
  request: RequestFn,
  id: string,
  parentId: string,
  initialMetadataUpdates: SyncDocumentOutgoingUpdate[],
  initialMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[],
) {
  return request(
    "/containers",
    isCreateContainerResponse,
    "POST",
    JSON.stringify({
      id,
      initialMetadataRecipientEnvelopes,
      initialMetadataUpdates,
      parentId,
    }),
  );
}
