import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
  resolveContainerReaderProjection,
} from "../containers/writerProjection";

interface AuthorizingContainerPathCandidates {
  readonly paths: ContainerWriterProjectionResponse[];
}

export async function resolveAuthorizingContainerPathCandidates(input: {
  readonly containerIds: readonly string[];
  readonly context: ContainerWriterProjectionContext;
  readonly executor: DatabaseSession;
  readonly userId: string;
}): Promise<AuthorizingContainerPathCandidates> {
  const results = await gatherWithExecutor(
    input.executor,
    input.containerIds,
    async (containerId): Promise<ContainerWriterProjectionResponse | null> => {
      try {
        // Document sync also uses this projection for read-only pulls. Mutations
        // still verify write access before accepting document updates.
        return await resolveContainerReaderProjection({
          containerId,
          context: input.context,
          executor: input.executor,
          userId: input.userId,
        });
      } catch (error) {
        if (
          error instanceof ContainerWriterProjectionError &&
          error.status === 403
        ) {
          return null;
        }
        throw error;
      }
    },
  );

  return {
    paths: results.flatMap((projection) =>
      projection === null ? [] : [projection],
    ),
  };
}
