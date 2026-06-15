export { createDomainScope, type DomainScope } from "../../data/domainScope";
export type {
  DomainSyncCoordinator,
  DomainSyncSnapshot,
  SyncIdleOptions,
  SyncLane,
  SyncLaneConfig,
  SyncLaneLastAction,
  SyncLanePhase,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "../../data/sync/syncCoordinator";
export {
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  hasDomainSyncCoordinatorPendingWork,
  subscribeToDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
