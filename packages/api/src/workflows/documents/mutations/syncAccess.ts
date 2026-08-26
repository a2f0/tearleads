import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "../../containers/writerProjection";
import { DocumentMutationError } from "./errors";

export async function ensureCurrentDocumentAccess(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly executor: DatabaseTransaction;
  readonly minimumAccessLevel: "read" | "write";
  readonly userId: string;
}): Promise<void> {
  const context = createContainerWriterProjectionContext(input.executor);

  for (const containerId of new Set(
    input.currentTargets.targets.map((target) => target.containerId),
  )) {
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
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
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
    currentTargets: input.currentTargets,
    executor: input.executor,
    minimumAccessLevel,
    userId: input.userId,
  });
}
