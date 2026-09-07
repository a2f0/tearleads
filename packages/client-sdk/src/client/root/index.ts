import {
  listRootIdentities,
  listRootIdentityOrganizations,
  loadRootIdentity,
  type RootIdentitiesPage,
  type RootIdentitiesQueryInput,
  type RootIdentityDetail,
  type RootIdentityOrganization,
  type RootRequestOutcome,
} from "../../workflows/root";
import type { InternalRuntime } from "../workflowRuntime";

export type {
  RootIdentitiesPage,
  RootIdentitiesQueryInput,
  RootIdentityDetail,
  RootIdentityOrganization,
  RootRequestOutcome,
} from "../../workflows/root";

/**
 * Platform-operator lookups. Every call is refused locally unless the session
 * is authenticated and the server reported it as root at login; the API still
 * enforces root access on its own, so this gate only avoids doomed requests.
 */
export interface Root {
  /** Whether the current session may use the root surface at all. */
  readonly isAvailable: boolean;
  listIdentities(
    query?: RootIdentitiesQueryInput,
  ): Promise<RootRequestOutcome<RootIdentitiesPage>>;
  listIdentityOrganizations(
    userId: string,
  ): Promise<RootRequestOutcome<RootIdentityOrganization[]>>;
  loadIdentity(userId: string): Promise<RootRequestOutcome<RootIdentityDetail>>;
}

const NOT_AVAILABLE: RootRequestOutcome<never> = {
  message: "The current session is not a platform operator.",
  ok: false,
  status: null,
};

export function createRoot(runtimeService: InternalRuntime): Root {
  const activeRuntime = () => {
    const runtime = runtimeService.workflowInput();
    return runtime.auth.isAuthenticated && runtime.auth.isRoot === true
      ? runtime
      : null;
  };

  return {
    get isAvailable() {
      return activeRuntime() !== null;
    },
    async listIdentities(query) {
      const runtime = activeRuntime();
      return runtime
        ? listRootIdentities(runtime.apiClient, query)
        : NOT_AVAILABLE;
    },
    async listIdentityOrganizations(userId) {
      const runtime = activeRuntime();
      return runtime
        ? listRootIdentityOrganizations(runtime.apiClient, userId)
        : NOT_AVAILABLE;
    },
    async loadIdentity(userId) {
      const runtime = activeRuntime();
      return runtime
        ? loadRootIdentity(runtime.apiClient, userId)
        : NOT_AVAILABLE;
    },
  };
}
