import { createPendingUpdateFields } from "../../data/documents/documentSync";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export async function enqueueInitialContainerMetadataUpdate(
  execSql: ExecSql,
  containerId: string,
  initialUpdate: Uint8Array,
  initialUpdateCommitted: boolean | undefined,
): Promise<void> {
  if (initialUpdateCommitted === true) {
    return;
  }
  const initialMetadataUpdate = createPendingUpdateFields(initialUpdate);
  if (!initialMetadataUpdate) {
    return;
  }
  await sqlContainerContentsPersistence.enqueuePendingUpdate(execSql, {
    containerId,
    ...initialMetadataUpdate,
  });
}
