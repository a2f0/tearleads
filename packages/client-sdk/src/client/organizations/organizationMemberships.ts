import {
  type OrganizationContentHost,
  type OrganizationLeaveRequestResult,
  type OrganizationMembership,
  type OrganizationSyncPauseResult,
  refreshOrganizationMemberships,
  setOrganizationLeaveRequested,
  setOrganizationSyncPaused,
} from "../../workflows/organizations";
import { loadCurrentMembersHead } from "../../workflows/organizations/memberships/leaveRequestMembersEvidence";
import {
  type DomainScope,
  getOrCreateOrganizationSyncPauses,
  hasDomainSyncCoordinatorPendingWork,
  requestAllDomainSyncLanes,
  subscribeToDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../workflows/sync";
import {
  type ContainerContents,
  carriesLocalWrites,
} from "../containerContents";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../runtime/workflowRuntime";

// Long enough for a typical upload burst, short enough to answer a tap.
const PAUSE_FLUSH_TIMEOUT_MS = 10_000;

/** The user's own conduit to the organizations they belong to. */
export interface OrganizationMemberships {
  /**
   * Reads the user's memberships and applies their pause choices on this
   * device. Null when offline or the list could not be read.
   */
  refresh(): Promise<OrganizationMembership[] | null>;
  /** Pauses or resumes one organization for all of the user's devices. */
  setSyncPaused(
    organizationId: string,
    paused: boolean,
  ): Promise<OrganizationSyncPauseResult>;
  /**
   * Asks the organization's administrators to remove the user, or withdraws
   * that request. Signed with the user's identity key; an administrator still
   * has to approve it.
   */
  setLeaveRequested(
    organizationId: string,
    requested: boolean,
  ): Promise<OrganizationLeaveRequestResult>;
  /** The organizations paused on this device, read from local storage. */
  loadPausedOrganizationIds(): Promise<ReadonlySet<string>>;
  /** Notifies when the paused set for the current scope changes. */
  subscribeToSyncPauses(listener: () => void): () => void;
  /**
   * Hands each membership list a refresh reads for the current scope, so a
   * choice made on another device reaches every view of it.
   */
  subscribeToMemberships(
    listener: (memberships: readonly OrganizationMembership[]) => void,
  ): () => void;
}

type MembershipsListener = (
  memberships: readonly OrganizationMembership[],
) => void;

const membershipListenersByScope = new WeakMap<
  DomainScope,
  Set<MembershipsListener>
>();

/**
 * The scope's document reconciler. Containers it reconciled before a pause
 * stay marked as listed, so a resume has to forget that before reconciling.
 */
export interface OrganizationContentReconciler {
  resetDiscovered(): void;
  reconcileNow(options: { readonly freshListing: true }): Promise<void>;
}

interface SettleRetry {
  retry: () => Promise<boolean>;
  running: boolean;
  unsubscribe: () => void;
}

const settleRetriesByScope = new WeakMap<DomainScope, SettleRetry>();

// One retry per scope: it runs whenever the scope's sync lanes go idle and
// stops once it reports the work done.
export function retryWhenWritesSettle(
  domainScope: DomainScope,
  retry: () => Promise<boolean>,
): void {
  const existing = settleRetriesByScope.get(domainScope);
  if (existing) {
    existing.retry = retry;
    return;
  }
  const entry: SettleRetry = { retry, running: false, unsubscribe: () => {} };
  settleRetriesByScope.set(domainScope, entry);
  const attempt = () => {
    if (entry.running || hasDomainSyncCoordinatorPendingWork(domainScope)) {
      return;
    }
    entry.running = true;
    void entry
      .retry()
      .then(
        (done) => {
          if (!done) return;
          entry.unsubscribe();
          settleRetriesByScope.delete(domainScope);
        },
        () => undefined,
      )
      .finally(() => {
        entry.running = false;
      });
  };
  entry.unsubscribe = subscribeToDomainSyncCoordinator(domainScope, attempt);
  // The lanes may already have gone idle before the subscription existed.
  attempt();
}

// Bound to the scope the operation started in: the tree is opened once, and
// every action re-checks the scope so stale work never reaches another
// identity's device state.
function createOrganizationContentHost(
  runtime: InternalWorkflowRuntimeInput,
  containerContents: ContainerContents,
  openReconciler: () => OrganizationContentReconciler,
  isCurrent: () => boolean,
): OrganizationContentHost {
  const { domainScope } = runtime.state;
  const tree = containerContents.openTree();
  return {
    async forgetOrganizationContent(organizationId) {
      // A scope that ended has nothing left to retry.
      if (!isCurrent()) return true;
      return tree.forgetOrganizationContent(organizationId);
    },
    async hasUnsyncedOrganizationWrites(organizationId) {
      if (!isCurrent()) return true;
      const pending = await containerContents
        .documentQueries()
        .listPendingWrites();
      return pending.some(
        (item) =>
          item.organizationId === organizationId && carriesLocalWrites(item),
      );
    },
    async flushWrites() {
      requestAllDomainSyncLanes(domainScope);
      await waitForDomainSyncCoordinatorToSettle(domainScope, {
        timeoutMs: PAUSE_FLUSH_TIMEOUT_MS,
      });
    },
    async refetchContent() {
      if (!isCurrent()) return;
      // Re-lists the whole tree and every container's documents. The resumed
      // organization's folders were listed before the pause, and a hydration
      // may already have restored them, so they must be forgotten explicitly.
      // A sweep that started listing while paused would miss them, so this
      // one queues behind it rather than joining it.
      const reconciler = openReconciler();
      reconciler.resetDiscovered();
      await reconciler.reconcileNow({ freshListing: true });
    },
    retryWhenWritesSettle: (retry) => retryWhenWritesSettle(domainScope, retry),
  };
}

function canReachServer(runtime: InternalWorkflowRuntimeInput): boolean {
  return (
    runtime.infra.dbStatus === "ready" &&
    runtime.auth.isAuthenticated &&
    runtime.state.online
  );
}

function setLeaveRequestedFor(
  runtimeService: InternalRuntime,
  organizationId: string,
  requested: boolean,
): Promise<OrganizationLeaveRequestResult> {
  const runtime = runtimeService.workflowInput();
  const { userId } = runtime.auth;
  const { signingKeyPair } = runtime.crypto;
  if (!canReachServer(runtime) || !userId || !signingKeyPair) {
    return Promise.resolve({
      httpStatus: null,
      message: "Connect to ask to leave an organization.",
      status: "failed",
    });
  }
  const { domainScope } = runtime.state;
  return setOrganizationLeaveRequested({
    apiClient: runtime.apiClient,
    loadMembersHead: () =>
      loadCurrentMembersHead({
        organizationId,
        runtime,
        stillCurrent: () =>
          runtimeService.workflowInput().state.domainScope === domainScope,
      }),
    organizationId,
    requested,
    signer: { signingKeyPair, userId },
  });
}

export function createOrganizationMemberships(
  runtimeService: InternalRuntime,
  containerContents: ContainerContents,
  openReconciler: () => OrganizationContentReconciler,
): OrganizationMemberships {
  const membershipInput = (runtime: InternalWorkflowRuntimeInput) => {
    const { domainScope } = runtime.state;
    const isCurrent = () =>
      runtimeService.workflowInput().state.domainScope === domainScope;
    return {
      apiClient: runtime.apiClient,
      domainScope,
      execSql: runtime.infra.execSql,
      host: createOrganizationContentHost(
        runtime,
        containerContents,
        openReconciler,
        isCurrent,
      ),
      isCurrent,
    };
  };
  return {
    async refresh() {
      const runtime = runtimeService.workflowInput();
      if (!canReachServer(runtime)) return null;
      const memberships = await refreshOrganizationMemberships(
        membershipInput(runtime),
      );
      const listeners = membershipListenersByScope.get(
        runtime.state.domainScope,
      );
      if (memberships && listeners) {
        for (const listener of [...listeners]) listener(memberships);
      }
      return memberships;
    },
    async setSyncPaused(organizationId, paused) {
      const runtime = runtimeService.workflowInput();
      if (!canReachServer(runtime)) {
        return {
          httpStatus: null,
          message: "Connect to change sync for an organization.",
          status: "failed",
        };
      }
      return setOrganizationSyncPaused({
        ...membershipInput(runtime),
        organizationId,
        paused,
      });
    },
    setLeaveRequested: (organizationId, requested) =>
      setLeaveRequestedFor(runtimeService, organizationId, requested),
    async loadPausedOrganizationIds() {
      const runtime = runtimeService.workflowInput();
      if (runtime.infra.dbStatus !== "ready") return new Set<string>();
      const pauses = getOrCreateOrganizationSyncPauses(
        runtime.state.domainScope,
      );
      await pauses.load(runtime.infra.execSql);
      return pauses.pausedOrganizationIds();
    },
    subscribeToSyncPauses(listener) {
      return getOrCreateOrganizationSyncPauses(
        runtimeService.workflowInput().state.domainScope,
      ).subscribe(listener);
    },
    subscribeToMemberships(listener) {
      const { domainScope } = runtimeService.workflowInput().state;
      const listeners =
        membershipListenersByScope.get(domainScope) ?? new Set();
      membershipListenersByScope.set(domainScope, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
