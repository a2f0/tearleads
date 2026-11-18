import {
  type ListContainerDocumentLanesRequest,
  MAX_CONTAINER_DOCUMENT_LANES,
} from "@tearleads/validators/request";
import type {
  ContainerSyncTombstone,
  ListContainerDocumentLanesResponse,
} from "@tearleads/validators/response";
import { isContainerNotFoundFailure } from "../../../../data/containers/shared/mutationFailures";
import { collectRemovedContainers } from "../tombstoneReasons";
import type {
  ContainerChildIndex,
  ExpectedContainerState,
  RemoteContainerHydrationState,
} from "../types";

function classifyLane(
  result: ListContainerDocumentLanesResponse["results"][number] | undefined,
) {
  if (!result) return "unknown";
  if ("page" in result) return "readable";
  return result.failure.status === 403 ||
    isContainerNotFoundFailure(result.failure)
    ? "denied"
    : "unknown";
}

/** A successful lane read proves the device should retain its existing row.
 * A lane-local access denial or coded absence confirms a discovery removal.
 * Any other outcome leaves the page retryable. */
async function readTombstoneCascadeAccess(
  api: RemoteContainerHydrationState["runtime"]["apiClient"],
  containerIds: readonly string[],
  afterParentPage: NonNullable<
    ListContainerDocumentLanesRequest["afterParentPage"]
  >,
  isCurrent?: (() => boolean) | undefined,
) {
  const denied = new Set<string>();
  for (
    let index = 0;
    index < containerIds.length;
    index += MAX_CONTAINER_DOCUMENT_LANES
  ) {
    if (isCurrent?.() === false) return null;
    const ids = containerIds.slice(index, index + MAX_CONTAINER_DOCUMENT_LANES);
    const response = await api.listContainerDocumentLanes(
      {
        afterParentPage,
        lanes: ids.map((containerId, i) => ({
          containerId,
          laneId: String(i),
          watermark: null,
          limit: 1,
        })),
      },
      { reportErrors: false },
    );
    if (!response || response.results.length !== ids.length) return null;
    for (const [i, containerId] of ids.entries()) {
      const result = response.results.find((row) => row.laneId === String(i));
      const outcome = classifyLane(result);
      if (outcome === "unknown") return null;
      if (outcome === "denied") denied.add(containerId);
    }
  }
  return { denied };
}

export async function resolveTombstoneCascade(input: {
  afterParentPage: ListContainerDocumentLanesRequest["afterParentPage"];
  childIdsByParentId: ContainerChildIndex;
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>;
  isCurrent?: (() => boolean) | undefined;
  preservedContainerIds: ReadonlySet<string>;
  state: RemoteContainerHydrationState;
  tombstone: ContainerSyncTombstone;
}): Promise<{
  cascade: ReturnType<typeof collectRemovedContainers>;
  denied: ReadonlySet<string> | null;
} | null> {
  const cascade = (preservedContainerIds: ReadonlySet<string>) =>
    collectRemovedContainers({
      childIdsByParentId: input.childIdsByParentId,
      containersById: input.state.containersById,
      preservedContainerIds,
      tombstones: [input.tombstone],
    });
  const candidates = cascade(input.preservedContainerIds);
  const clockConflict = candidates.removedContainerIds.some((id) => {
    const held =
      input.expectedContainerStates.get(id)?.container.serverUpdatedAt;
    return held != null && held > input.tombstone.updatedAt;
  });
  if (!clockConflict) return { cascade: candidates, denied: null };

  if (!input.afterParentPage) return null;
  const access = await readTombstoneCascadeAccess(
    input.state.runtime.apiClient,
    [
      ...new Set([
        input.tombstone.containerId,
        ...candidates.removedContainerIds,
      ]),
    ],
    input.afterParentPage,
    input.isCurrent,
  );
  // A move before the server upgrade may have left a superseded removal in
  // its old lane. Preserve a currently readable root and advance past it.
  if (!access) return null;
  return {
    // A cached descendant may have moved away from a still-readable ancestor.
    // The batch checked every candidate independently.
    cascade: {
      ...candidates,
      removedContainerIds: candidates.removedContainerIds.filter((id) =>
        access.denied.has(id),
      ),
      fenceOnlyContainerIds: candidates.fenceOnlyContainerIds.filter((id) =>
        access.denied.has(id),
      ),
      absentDeletedContainerIds: candidates.absentDeletedContainerIds.filter(
        (id) => access.denied.has(id),
      ),
    },
    denied: access.denied,
  };
}
