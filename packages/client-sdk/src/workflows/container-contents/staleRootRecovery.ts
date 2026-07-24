import type { ContainerContentsPersistence } from "./containerPersistence";
import type { ContainerState } from "./remoteHydration";
import type {
  ContainerContentsRootAdopter,
  ContainerContentsWorkflowRuntime,
} from "./runtime";

type StaleRootRecoveryStatus =
  | "ambiguous"
  | "context-changed"
  | "not-needed"
  | "reassigned"
  | "unsupported";

interface StaleRootRecoveryResult {
  readonly candidateCount: number;
  readonly status: StaleRootRecoveryStatus;
}

interface StaleRootRecoveryState {
  readonly containersById: ReadonlyMap<string, ContainerState>;
  readonly persistence: Pick<
    ContainerContentsPersistence,
    "loadContainers" | "reassignContainerDocuments"
  >;
  readonly runtime: {
    readonly adoptRootContainer?: ContainerContentsRootAdopter | undefined;
    readonly auth: Pick<
      ContainerContentsWorkflowRuntime["auth"],
      "isAuthenticated" | "organizationId" | "userId"
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
    organizationId: string;
    staleContainerId: string;
    userId: string;
  },
): boolean {
  return (
    state.runtime.auth.isAuthenticated &&
    state.runtime.auth.organizationId === input.organizationId &&
    state.runtime.auth.userId === input.userId &&
    state.runtime.state.containerId === input.staleContainerId &&
    state.runtime.state.domainScope === input.domainScope
  );
}

function hasRemoteContainerMetadataState(
  containerState: ContainerState,
): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0 &&
    typeof containerState.container.metadataDocumentId === "string" &&
    containerState.container.metadataDocumentId.length > 0
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
      hasRemoteContainerMetadataState(containerState),
  );
}

/**
 * Repairs the root identity left by older cold-cache logins.
 *
 * Root reconciliation used to delete the device-first local root without
 * updating the session's default container. Notes created afterward were
 * durably projected beneath that deleted id, so subtree priming could detect
 * their writes but could not route them. Recovery is intentionally narrow: the
 * stale id must be absent from both the loaded topology and durable storage,
 * and the active organization must have exactly one remote-backed top-level
 * root. Ambiguous/shared topology is never rehomed.
 */
export async function recoverStaleSessionRoot(
  state: StaleRootRecoveryState,
): Promise<StaleRootRecoveryResult> {
  const staleContainerId = state.runtime.state.containerId;
  const domainScope = state.runtime.state.domainScope;
  const organizationId = state.runtime.auth.organizationId;
  const userId = state.runtime.auth.userId;
  if (
    !state.runtime.auth.isAuthenticated ||
    !staleContainerId ||
    !organizationId ||
    !userId ||
    state.containersById.has(staleContainerId)
  ) {
    return { candidateCount: 0, status: "not-needed" };
  }

  const storedContainers = await state.persistence.loadContainers(
    state.runtime.infra.execSql,
  );
  if (
    storedContainers.some(({ container }) => container.id === staleContainerId)
  ) {
    return { candidateCount: 0, status: "not-needed" };
  }
  if (
    !hasSameRecoveryContext(state, {
      domainScope,
      organizationId,
      staleContainerId,
      userId,
    })
  ) {
    return { candidateCount: 0, status: "context-changed" };
  }
  if (state.containersById.has(staleContainerId)) {
    return { candidateCount: 0, status: "not-needed" };
  }

  const candidates = listAuthoritativeRootCandidates(state, organizationId);
  if (candidates.length !== 1) {
    return { candidateCount: candidates.length, status: "ambiguous" };
  }
  if (!state.runtime.adoptRootContainer) {
    return { candidateCount: 1, status: "unsupported" };
  }

  const [remoteRootState] = candidates;
  if (!remoteRootState) {
    return { candidateCount: 0, status: "ambiguous" };
  }

  await state.persistence.reassignContainerDocuments(
    state.runtime.infra.execSql,
    {
      fromContainerId: staleContainerId,
      toContainerId: remoteRootState.container.id,
    },
  );
  const adopted = state.runtime.adoptRootContainer({
    domainScope,
    expectedContainerId: staleContainerId,
    nextContainerId: remoteRootState.container.id,
    organizationId,
    userId,
  });

  return {
    candidateCount: 1,
    status: adopted ? "reassigned" : "context-changed",
  };
}
