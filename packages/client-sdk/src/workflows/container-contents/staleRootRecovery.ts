import type { ContainerContentsPersistence } from "./containerPersistence";
import type { ContainerState } from "./remoteHydration";
import { hasRemoteContainerMetadataState } from "./remoteHydration/reconciliation";
import type {
  ContainerContentsRootAdopter,
  ContainerContentsWorkflowRuntime,
} from "./runtime";

export type StaleRootRecoveryStatus =
  | "already-adopted"
  | "ambiguous"
  | "context-changed"
  | "not-needed"
  | "reassigned"
  | "unsupported";

interface StaleRootRecoveryResult {
  readonly candidateCount: number;
  readonly reassigned: boolean;
  readonly status: StaleRootRecoveryStatus;
}

interface StaleRootRecoveryState {
  readonly containersById: ReadonlyMap<string, ContainerState>;
  readonly persistence: Pick<
    ContainerContentsPersistence,
    "containerExists" | "reassignContainerDocuments"
  >;
  readonly rootLaneHydrated: boolean;
  readonly runtime: {
    readonly adoptRootContainer?: ContainerContentsRootAdopter | undefined;
    readonly auth: Pick<
      ContainerContentsWorkflowRuntime["auth"],
      "defaultOrganizationId" | "isAuthenticated" | "organizationId" | "userId"
    >;
    readonly infra: Pick<ContainerContentsWorkflowRuntime["infra"], "execSql">;
    readonly state: Pick<
      ContainerContentsWorkflowRuntime["state"],
      "containerId" | "domainScope"
    >;
  };
}

function hasSameRecoveryContext(
  state: StaleRootRecoveryState,
  input: {
    domainScope: ContainerContentsWorkflowRuntime["state"]["domainScope"];
    defaultOrganizationId: string;
    organizationId: string;
    staleContainerId: string;
    userId: string;
  },
): boolean {
  return (
    state.runtime.auth.isAuthenticated &&
    state.runtime.auth.defaultOrganizationId === input.defaultOrganizationId &&
    state.runtime.auth.organizationId === input.organizationId &&
    state.runtime.auth.userId === input.userId &&
    state.runtime.state.containerId === input.staleContainerId &&
    state.runtime.state.domainScope === input.domainScope
  );
}

function listAuthoritativeRootCandidates(
  state: StaleRootRecoveryState,
  organizationId: string,
): ContainerState[] {
  return Array.from(state.containersById.values()).filter(
    (containerState) =>
      containerState.container.parentId === null &&
      containerState.container.organizationId === organizationId &&
      (containerState.container.systemSlot ?? null) === null &&
      containerState.container.effectiveAccessLevel === "admin" &&
      hasRemoteContainerMetadataState(containerState),
  );
}

/**
 * Repairs the root identity left by a cold-cache login.
 *
 * Root reconciliation can delete the device-first local root without updating
 * the session's default container. Documents created afterward are projected
 * beneath that deleted id, so startup priming detects their writes but cannot
 * route them. Recovery is intentionally narrow: the stale id must be absent
 * from both the loaded topology and durable storage, and the active
 * organization must have exactly one owner-administered, non-system,
 * remote-backed top-level root after the authoritative root lane has hydrated.
 * As in normal root reconciliation, the authenticated API topology is the
 * account authority here; root ownership is not independently corroborated by
 * a client-held signature. This recovery path only repairs document
 * references; structural container descendants remain owned by normal root
 * reconciliation. Durable reassignment deliberately precedes live session
 * adoption so consumers never observe the new root before its documents move.
 * If the live-session guard rejects that adoption, the idempotent reassignment
 * remains applied and the sync lane is re-armed to retry under the next runtime
 * snapshot.
 */
export async function recoverStaleSessionRoot(
  state: StaleRootRecoveryState,
  isCurrent: () => boolean = () => true,
): Promise<StaleRootRecoveryResult> {
  const staleContainerId = state.runtime.state.containerId;
  const domainScope = state.runtime.state.domainScope;
  const defaultOrganizationId = state.runtime.auth.defaultOrganizationId;
  const organizationId = state.runtime.auth.organizationId;
  const userId = state.runtime.auth.userId;
  if (
    !isCurrent() ||
    !state.runtime.auth.isAuthenticated ||
    !staleContainerId ||
    !defaultOrganizationId ||
    !organizationId ||
    !userId ||
    organizationId !== defaultOrganizationId ||
    !state.rootLaneHydrated ||
    state.containersById.has(staleContainerId)
  ) {
    return { candidateCount: 0, reassigned: false, status: "not-needed" };
  }
  const recoveryContext = {
    domainScope,
    defaultOrganizationId,
    organizationId,
    staleContainerId,
    userId,
  };

  const storedContainerExists = await state.persistence.containerExists(
    state.runtime.infra.execSql,
    staleContainerId,
  );
  if (storedContainerExists) {
    return { candidateCount: 0, reassigned: false, status: "not-needed" };
  }
  if (!isCurrent() || !hasSameRecoveryContext(state, recoveryContext)) {
    return { candidateCount: 0, reassigned: false, status: "context-changed" };
  }
  if (state.containersById.has(staleContainerId)) {
    return { candidateCount: 0, reassigned: false, status: "not-needed" };
  }

  const candidates = listAuthoritativeRootCandidates(
    state,
    defaultOrganizationId,
  );
  const [remoteRootState] = candidates;
  if (!remoteRootState || candidates.length > 1) {
    return {
      candidateCount: candidates.length,
      reassigned: false,
      status: "ambiguous",
    };
  }
  if (!state.runtime.adoptRootContainer) {
    return { candidateCount: 1, reassigned: false, status: "unsupported" };
  }
  if (!isCurrent() || !hasSameRecoveryContext(state, recoveryContext)) {
    return { candidateCount: 0, reassigned: false, status: "context-changed" };
  }

  await state.persistence.reassignContainerDocuments(
    state.runtime.infra.execSql,
    {
      fromContainerId: staleContainerId,
      stillCurrent: isCurrent,
      toContainerId: remoteRootState.container.id,
    },
  );
  if (!isCurrent() || !hasSameRecoveryContext(state, recoveryContext)) {
    return { candidateCount: 1, reassigned: false, status: "context-changed" };
  }
  const adoptionResult = state.runtime.adoptRootContainer({
    domainScope,
    expectedContainerId: staleContainerId,
    nextContainerId: remoteRootState.container.id,
    organizationId,
    userId,
  });

  return {
    candidateCount: 1,
    reassigned: true,
    status:
      adoptionResult === "already-adopted"
        ? "already-adopted"
        : adoptionResult
          ? "reassigned"
          : "context-changed",
  };
}
