import { getOrCreateOrganizationSyncPauses } from "../../../../data/sync/organizationSyncPauses";
import type { RemoteContainerHydrationState } from "../types";

/**
 * Loads the scope's paused organizations and returns the predicate remote
 * hydration uses to leave their containers off the device. The session's
 * active organization is never skipped.
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
  const activeOrganizationId = state.runtime.auth.organizationId ?? null;
  return (container) =>
    syncPauses.isContainerPaused(container, activeOrganizationId);
}
