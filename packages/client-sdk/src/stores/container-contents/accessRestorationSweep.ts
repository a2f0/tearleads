import {
  type RemoteHydrationRequester,
  refreshAllRemoteHydration,
} from "./remoteHydrationRefresh";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

type DormantMetadataSweep = Awaited<
  ReturnType<
    ContainerContentsStoreSyncState["persistence"]["listDormantMetadataSweepRequests"]
  >
>[number];

async function proveDeletedContainerIds(
  state: ContainerContentsStoreSyncState,
  sweep: DormantMetadataSweep,
): Promise<{ deletedContainerIds: string[]; shouldRetry: boolean }> {
  const deletedContainerIds: string[] = [];
  let afterContainerId: string | undefined;
  let shouldRetry = false;

  while (true) {
    const candidates =
      await state.persistence.listDormantMetadataSweepCandidates(
        state.runtime.infra.execSql,
        sweep,
        afterContainerId,
      );
    if (candidates.length === 0) {
      return { deletedContainerIds, shouldRetry };
    }

    for (const containerId of candidates) {
      // A cached success can predate revocation. Evict it so this request is a
      // fresh server-side existence proof made after the full restoration crawl.
      state.runtime.apiClient.evictContainerWriterProjection(containerId);
      const result =
        await state.runtime.apiClient.getContainerWriterProjectionResult(
          containerId,
          { reportErrors: false },
        );
      if (!result.ok && result.kind === "http" && result.status === 404) {
        deletedContainerIds.push(containerId);
      } else if (!result.ok && result.status !== 403) {
        // A 403 means the container is live but still unavailable (including a
        // read-only grant), so its edits stay dormant. Every other failure is
        // inconclusive and keeps the durable request for a later natural retry.
        shouldRetry = true;
      }
    }

    afterContainerId = candidates.at(-1);
  }
}

async function completeRestorationSweeps(
  state: ContainerContentsStoreSyncState,
  sweeps: readonly DormantMetadataSweep[],
): Promise<void> {
  for (const sweep of sweeps) {
    const { deletedContainerIds, shouldRetry } = await proveDeletedContainerIds(
      state,
      sweep,
    );
    const purgedCount =
      await state.persistence.purgeDormantContainerMetadataCandidates(
        state.runtime.infra.execSql,
        sweep,
        deletedContainerIds,
      );
    if (shouldRetry) {
      state.runtime.util.log(
        `${state.logLabel ?? "Container contents"}: deferred dormant metadata sweep after an inconclusive deletion probe`,
      );
      continue;
    }
    await state.persistence.completeDormantMetadataSweepRequest(
      state.runtime.infra.execSql,
      sweep,
    );
    if (purgedCount > 0) {
      state.runtime.util.log(
        `${state.logLabel ?? "Container contents"}: purged ${purgedCount} dormant metadata document(s) after access restoration`,
      );
    }
  }
}

export function createRestoredAccessReconciler(input: {
  requestHydration: RemoteHydrationRequester;
  state: ContainerContentsStoreSyncState;
}): () => Promise<void> {
  const { requestHydration, state } = input;
  return async () => {
    const requesterUserId = state.runtime.auth.userId;
    if (!requesterUserId) {
      return;
    }
    const sweeps = await state.persistence.listDormantMetadataSweepRequests(
      state.runtime.infra.execSql,
      requesterUserId,
    );
    if (sweeps.length === 0) {
      return;
    }

    await refreshAllRemoteHydration({
      onFullyHydrated: async () => {
        try {
          await completeRestorationSweeps(state, sweeps);
        } catch (error) {
          const message = `${state.logLabel ?? "Container contents"}: dormant metadata sweep failed`;
          if (state.runtime.util.logError) {
            state.runtime.util.logError(message, error);
          } else {
            state.runtime.util.log(message);
          }
        }
      },
      requestHydration,
      resetAllLaneWatermarks: true,
      scheduleSyncAfterHydration: false,
      state,
    });
  };
}
