import { MAX_CONTAINER_DOCUMENT_LANES } from "@tearleads/validators/request";
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
  isCurrent?: (() => boolean) | undefined,
) {
  const readable = new Set<string>();
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
      (outcome === "readable" ? readable : denied).add(containerId);
    }
  }
  return { denied, readable };
}

export async function resolveTombstoneCascade(input: {
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

  const access = await readTombstoneCascadeAccess(
    input.state.runtime.apiClient,
    [
      ...new Set([
        input.tombstone.containerId,
        ...candidates.removedContainerIds,
      ]),
    ],
    input.isCurrent,
  );
  // A readable root contradicts the removal. Its grant restoration prunes the
  // tombstone; retry from the same cursor until the views agree.
  if (!access || access.readable.has(input.tombstone.containerId)) return null;
  return {
    cascade: cascade(
      new Set([...input.preservedContainerIds, ...access.readable]),
    ),
    denied: access.denied,
  };
}
