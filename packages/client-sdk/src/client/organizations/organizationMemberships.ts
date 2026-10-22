import {
  type OrganizationContentHost,
  type OrganizationMembership,
  type OrganizationSyncPauseResult,
  refreshOrganizationMemberships,
  setOrganizationSyncPaused,
} from "../../workflows/organizations";
import {
  getOrCreateOrganizationSyncPauses,
  requestAllDomainSyncLanes,
  waitForDomainSyncCoordinatorToSettle,
} from "../../workflows/sync";
import type { ContainerContents } from "../containerContents";
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
  /** The organizations paused on this device, read from local storage. */
  loadPausedOrganizationIds(): Promise<ReadonlySet<string>>;
  /** Notifies when the paused set for the current scope changes. */
  subscribeToSyncPauses(listener: () => void): () => void;
}

function createOrganizationContentHost(
  runtime: InternalWorkflowRuntimeInput,
  containerContents: ContainerContents,
): OrganizationContentHost {
  const { domainScope } = runtime.state;
  return {
    forgetOrganizationContent: (organizationId) =>
      containerContents.openTree().forgetOrganizationContent(organizationId),
    async hasUnsyncedOrganizationWrites(organizationId) {
      const pending = await containerContents
        .documentQueries()
        .listPendingWrites();
      return pending.some((item) => item.organizationId === organizationId);
    },
    async flushWrites() {
      requestAllDomainSyncLanes(domainScope);
      await waitForDomainSyncCoordinatorToSettle(domainScope, {
        timeoutMs: PAUSE_FLUSH_TIMEOUT_MS,
      });
    },
    async refetchContent() {
      await containerContents.openTree().refresh();
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

export function createOrganizationMemberships(
  runtimeService: InternalRuntime,
  containerContents: ContainerContents,
): OrganizationMemberships {
  const membershipInput = (runtime: InternalWorkflowRuntimeInput) => ({
    apiClient: runtime.apiClient,
    domainScope: runtime.state.domainScope,
    execSql: runtime.infra.execSql,
    host: createOrganizationContentHost(runtime, containerContents),
  });
  return {
    async refresh() {
      const runtime = runtimeService.workflowInput();
      if (!canReachServer(runtime)) return null;
      return refreshOrganizationMemberships(membershipInput(runtime));
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
  };
}
