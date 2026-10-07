import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { projectionWithCurrentAncestors } from "./shareAncestorRepair";

/** The container's projection, with any lazily stale chain above it repaired. */
export async function resolveShareProjection(
  input: Omit<
    Parameters<typeof projectionWithCurrentAncestors>[0],
    "previousProjection" | "resolveProjectionUserKey"
  > & { previousProjection?: ContainerWriterProjectionResponse | undefined },
  resolveProjectionUserKey: ProjectionUserKeyResolver,
): Promise<ContainerWriterProjectionResponse | null> {
  const servedProjection =
    input.previousProjection ??
    (await input.apiClient.getContainerWriterProjection(input.containerId));
  if (!servedProjection || input.stillCurrent?.() === false) return null;
  const previousProjection = await projectionWithCurrentAncestors({
    ...input,
    previousProjection: servedProjection,
    resolveProjectionUserKey,
  });
  return input.stillCurrent?.() === false ? null : previousProjection;
}
