export { createDomainScope, type DomainScope } from "../../data/domainScope";
export {
  getOrCreateDomainSyncCoordinator,
  hasDomainSyncCoordinatorPendingWork,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
