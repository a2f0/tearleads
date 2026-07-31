import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerReaderProjection,
  resolveContainerWriterProjection,
} from "../../containers/writerProjection";
import { DocumentMutationError } from "./errors";

type ContainerProjectionResolver = typeof resolveContainerWriterProjection;

async function ensureDocumentAccess(
  input: {
    readonly currentTargets: Awaited<
      ReturnType<typeof resolveCurrentDocumentKekTargets>
    >;
    readonly executor: DatabaseTransaction;
    readonly userId: string;
  },
  resolver: ContainerProjectionResolver,
): Promise<void> {
  const context = createContainerWriterProjectionContext(input.executor);

  for (const containerId of new Set(
    input.currentTargets.targets.map((target) => target.containerId),
  )) {
    try {
      await resolver({
        containerId,
        context,
        executor: input.executor,
        // Authorization only — the response is discarded, so never pay the
        // manifest-lineage walk and historical policy loading here.
        includePredecessorKeks: false,
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
  const resolver =
    input.request.outgoingUpdates.length > 0
      ? resolveContainerWriterProjection
      : resolveContainerReaderProjection;
  await ensureDocumentAccess(
    {
      currentTargets: input.currentTargets,
      executor: input.executor,
      userId: input.userId,
    },
    resolver,
  );
}
