import type { DomainScope } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useDomainSyncSnapshot } from "../../providers/sdk/useDomainSyncSnapshot";
import {
  type SyncHolds,
  selectSyncHolds,
  summarizeSyncLanes,
} from "./syncActivityModel";
import {
  type SyncActivityDelays,
  useHeldSyncActivity,
} from "./useHeldSyncActivity";
import { useLastOfflineWindow } from "./useLastOfflineWindow";

export interface SyncLaneHolds extends Omit<SyncHolds, "laneActive"> {
  /** Sync work has been running for a moment (see `useHeldSyncActivity`). */
  readonly syncActive: boolean;
}

/**
 * The sync coordinator's lanes, the device's pauses, and the held activity,
 * as the tray's status reports them. The coordinator publishes on every lane
 * start, settle, and progress tick, while the counts the tray shows change far
 * less often, so the lane summary keeps one object per change and the status
 * and popover built on it follow only real changes.
 */
export function useSyncLaneHolds(input: {
  readonly activityDelays?: SyncActivityDelays | undefined;
  readonly dbReady: boolean;
  readonly domainScope: DomainScope;
  readonly online: boolean;
  readonly pausedOrganizationIds: ReadonlySet<string>;
  readonly writeOrganizationIds: ReadonlyArray<string>;
}): SyncLaneHolds {
  const syncSnapshot = useDomainSyncSnapshot(input.domainScope);
  const offlineWindow = useLastOfflineWindow(input.online, syncSnapshot);
  const { failed, firstError, running } = summarizeSyncLanes(
    syncSnapshot,
    offlineWindow,
  );
  const lanes = useMemo(
    () => ({ failed, firstError, running }),
    [failed, firstError, running],
  );
  const { laneActive, ...holds } = selectSyncHolds({
    dbReady: input.dbReady,
    lanes,
    online: input.online,
    pausedOrganizationIds: input.pausedOrganizationIds,
    writeOrganizationIds: input.writeOrganizationIds,
  });
  return {
    ...holds,
    syncActive: useHeldSyncActivity(laneActive, input.activityDelays),
  };
}
