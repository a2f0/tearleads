import type {
  ReconnectCrawl,
  RemoteContainerHydrationHost,
} from "../../../workflows/container-contents/remoteHydration";
import type { RemoteContainerHydrationState } from "../../../workflows/container-contents/remoteHydration/types";
import type { LocalContainerRefreshState } from "../localRefresh";

export type RemoteHydrationRequestState = RemoteContainerHydrationState &
  LocalContainerRefreshState & {
    containerParentIdsNeedingHydration: Set<string | null>;
    initializePromise: Promise<void> | null;
    lifecycleGeneration: number;
    remoteHydrationGeneration: number | null;
    remoteHydrationPromise: Promise<void> | null;
    remoteHydrationStructuralGeneration: number | null;
    rootLaneHydrated: boolean;
    snapshot: {
      ready: boolean;
    };
    structuralGeneration: number;
    trackHydration?: (request: Promise<unknown>) => void;
    writeGeneration?: number;
  };

export interface RemoteHydrationRequestInput {
  /**
   * Set for the crawl that regained sync prerequisites start. It lists what
   * the crawl after an acknowledged connection lists, so it holds its
   * listing until a connect attempt in flight settles
   * (`connectAttemptGate.ts`), and once superseded it is not retried while
   * that crawl is owed. Returns whether it is.
   */
  yieldsToReconnectCrawl?: (() => boolean) | undefined;
  ownsTreeReset?: () => boolean;
  followDiscoveredParentLanes?: boolean | undefined;
  host: RemoteContainerHydrationHost;
  reconnect?: ReconnectCrawl | undefined;
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetAllLaneWatermarks?: boolean | undefined;
  resetRootLaneWatermark?: boolean | undefined;
  recreateOnFullyHydratedAfterReset?:
    | (() => () => Promise<void> | void)
    | undefined;
  recreateOnFullyHydratedAtStart?: boolean | undefined;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSyncAfterHydration?: boolean | undefined;
  scheduleSyncOnHydrationChange?: boolean | undefined;
  scheduleSync: () => void;
  state: RemoteHydrationRequestState;
}

export interface RecoveryHydrationRequest {
  input: RemoteHydrationRequestInput;
  lifecycleGeneration: number;
  structuralGeneration: number;
}
