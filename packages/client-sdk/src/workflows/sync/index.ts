export { createDomainScope, type DomainScope } from "../../data/domainScope";
export type {
  DomainSyncCoordinator,
  SyncIdleOptions,
  SyncLane,
  SyncLaneConfig,
  SyncLanePhase,
} from "../../data/sync/syncCoordinator";
export {
  getOrCreateDomainSyncCoordinator,
  hasDomainSyncCoordinatorPendingWork,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
