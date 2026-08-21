import {
  emptyVersionVector,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@symcrypt/loro";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import { DocumentMutationError } from "../errors";

const INITIAL_UPDATE_SHAPE_ERROR =
  "Provisioned document requires exactly one initial update and no container rekeys";

export function assertProvisionedDocumentInitialUpdate(
  request: DocumentSyncRequest,
): void {
  if (
    !Array.isArray(request.outgoingUpdates) ||
    request.outgoingUpdates.length !== 1 ||
    (request.containerRekeys?.length ?? 0) > 0
  ) {
    throw new DocumentMutationError(INITIAL_UPDATE_SHAPE_ERROR, 400);
  }

  const initialUpdate = request.outgoingUpdates[0];
  if (!initialUpdate) {
    throw new DocumentMutationError(INITIAL_UPDATE_SHAPE_ERROR, 400);
  }

  let startsFromEmpty: boolean;
  let localVersionMatchesEnd: boolean;
  try {
    startsFromEmpty = satisfiesVersionVector(
      emptyVersionVector(),
      initialUpdate.partialStartVersionVector,
    );
    localVersionMatchesEnd = versionVectorsEqual(
      request.localVersionVector,
      initialUpdate.partialEndVersionVector,
    );
  } catch {
    throw new DocumentMutationError(
      "Provisioned document initial version vectors are invalid",
      400,
    );
  }

  if (!startsFromEmpty) {
    throw new DocumentMutationError(
      "Provisioned document initial update must start from an empty version vector",
      400,
    );
  }
  if (!localVersionMatchesEnd) {
    throw new DocumentMutationError(
      "Provisioned document local version vector must match the initial update end",
      400,
    );
  }
}
