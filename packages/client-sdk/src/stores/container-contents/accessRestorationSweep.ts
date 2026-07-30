import {
  type RemoteHydrationRequester,
  refreshAllRemoteHydration,
} from "./remoteHydrationRefresh";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

async function completeRestorationSweeps(
  state: ContainerContentsStoreSyncState,
  sweeps: Awaited<
    ReturnType<
      ContainerContentsStoreSyncState["persistence"]["listDormantMetadataSweepRequests"]
    >
  >,
): Promise<void> {
  for (const sweep of sweeps) {
    const purgedCount =
      await state.persistence.purgeUnmatchedDormantContainerMetadata(
        state.runtime.infra.execSql,
        sweep,
      );
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
      onFullyHydrated: () => completeRestorationSweeps(state, sweeps),
      requestHydration,
      state,
    });
  };
}
