import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "../../containers/writerProjection";
import { DocumentMutationError } from "./errors";

export async function ensureCurrentDocumentAccess(input: {
  /** The document's linked container ids, in link order. */
  readonly containerIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly minimumAccessLevel: "read" | "write";
  readonly userId: string;
}): Promise<void> {
  const context = createContainerWriterProjectionContext(input.executor);

  for (const containerId of new Set(input.containerIds)) {
    try {
      await resolveContainerAccessProjection({
        containerId,
        context,
        executor: input.executor,
        minimumAccessLevel: input.minimumAccessLevel,
        userId: input.userId,
      });
      return;
    } catch (error) {
      if (
        error instanceof ContainerWriterProjectionError &&
        error.status === 403
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new DocumentMutationError("Forbidden", 403);
}

export async function ensureSyncDocumentAccess(input: {
  readonly containerIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
  readonly userId: string;
}): Promise<void> {
  // Empty sync requests only pull missing updates, so read access is enough.
  const minimumAccessLevel =
    input.request.outgoingUpdates.length > 0
      ? ("write" as const)
      : ("read" as const);
  await ensureCurrentDocumentAccess({
    containerIds: input.containerIds,
    executor: input.executor,
    minimumAccessLevel,
    userId: input.userId,
  });
}
