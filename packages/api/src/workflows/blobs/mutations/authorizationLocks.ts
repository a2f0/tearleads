import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import { lockAccessManifestHeadsForShare } from "../../../access/read/accessManifestStore";
import { uniqueSortedStrings } from "../../../utils/array";
import { BlobMutationError } from "./types";

function assertEveryPlannedHeadWasLocked(
  plannedIds: readonly string[],
  lockedIds: readonly string[],
): void {
  const expectedIds = uniqueSortedStrings(plannedIds);
  if (
    expectedIds.length !== lockedIds.length ||
    expectedIds.some((objectId, index) => objectId !== lockedIds[index])
  ) {
    throw new BlobMutationError("Blob content-key target heads are stale", 409);
  }
}

export async function lockAttachmentAuthorizationHeadsForShare(input: {
  readonly containerIds: readonly string[];
  readonly documentIds: readonly string[];
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const lockedContainerIds = await lockAccessManifestHeadsForShare(
    "container",
    input.containerIds,
    input.executor,
  );
  assertEveryPlannedHeadWasLocked(input.containerIds, lockedContainerIds);

  const lockedDocumentIds = await lockAccessManifestHeadsForShare(
    "document",
    input.documentIds,
    input.executor,
  );
  assertEveryPlannedHeadWasLocked(input.documentIds, lockedDocumentIds);
}
