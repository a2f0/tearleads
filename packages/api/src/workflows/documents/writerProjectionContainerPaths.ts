import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  CONTAINER_WRITER_PROJECTION_ERROR_CODES,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
  resolveContainerReaderProjection,
} from "../containers/writerProjection";

interface AuthorizingContainerPathCandidates {
  readonly integrityError: ContainerWriterProjectionError | null;
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
    async (
      containerId,
    ): Promise<
      | { readonly projection: ContainerWriterProjectionResponse }
      | { readonly error: ContainerWriterProjectionError }
    > => {
      try {
        // Document sync also uses this projection for read-only pulls. Mutations
        // still verify write access before accepting document updates.
        return {
          projection: await resolveContainerReaderProjection({
            containerId,
            context: input.context,
            executor: input.executor,
            userId: input.userId,
          }),
        };
      } catch (error) {
        if (
          error instanceof ContainerWriterProjectionError &&
          (error.status === 403 ||
            error.code ===
              CONTAINER_WRITER_PROJECTION_ERROR_CODES.predecessorHistoryUnavailable)
        ) {
          return { error };
        }
        throw error;
      }
    },
  );

  return {
    integrityError:
      results
        .flatMap((result) => ("error" in result ? [result.error] : []))
        .find(
          (error) =>
            error.code ===
            CONTAINER_WRITER_PROJECTION_ERROR_CODES.predecessorHistoryUnavailable,
        ) ?? null,
    paths: results.flatMap((result) =>
      "projection" in result ? [result.projection] : [],
    ),
  };
}
