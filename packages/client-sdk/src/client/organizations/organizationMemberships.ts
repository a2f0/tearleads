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
  requestAllDomainSyncLanes,
} from "../../workflows/sync/coordination";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../runtime/workflowRuntime";

/** The user's own conduit to the organizations they belong to. */
export interface OrganizationMemberships {
  /**
   * Reads the user's memberships and applies their pause choices on this
   * device. Null when offline or the list could not be read.
   */
  refresh(): Promise<OrganizationMembership[] | null>;
  /**
   * Pauses or resumes one organization's sync. A pause holds uploads and
   * downloads and keeps the local copy; it follows the user to their other
   * devices, except on their personal organization.
   */
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

// Bound to the scope the operation started in, so stale work never reaches
// another identity's device state.
function createOrganizationContentHost(
  runtime: InternalWorkflowRuntimeInput,
  openReconciler: () => OrganizationContentReconciler,
  isCurrent: () => boolean,
): OrganizationContentHost {
  const { domainScope } = runtime.state;
  return {
    async resumeSync() {
      if (!isCurrent()) return;
      // A held write leaves its lane idle, so every lane is re-driven.
      requestAllDomainSyncLanes(domainScope);
      // Re-lists the whole tree and every container's documents. The resumed
      // organization's folders were listed before the pause, so they must be
      // forgotten explicitly. A sweep that started listing while paused
      // skipped them, so this one queues behind it rather than joining it.
      const reconciler = openReconciler();
      reconciler.resetDiscovered();
      await reconciler.reconcileNow({ freshListing: true });
    },
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
      host: createOrganizationContentHost(runtime, openReconciler, isCurrent),
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
