import { getOrCreateOrganizationSyncPauses } from "../../../../data/sync/organizationSyncPauses";
import type { RemoteContainerHydrationState } from "../types";

/**
 * Loads the scope's paused organizations and returns the predicate remote
 * hydration uses to hold their containers as the device last saw them.
 */
export async function loadPausedContainerFilter(
  state: RemoteContainerHydrationState,
): Promise<
  (container: {
    organizationId: string;
    parentId: string | null;
    systemSlot?: string | null | undefined;
  }) => boolean
> {
  const syncPauses = getOrCreateOrganizationSyncPauses(
    state.runtime.state.domainScope,
  );
  await syncPauses.load(state.runtime.infra.execSql);
  return (container) => syncPauses.isContainerPaused(container);
}
