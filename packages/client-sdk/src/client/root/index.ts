import {
  listRootIdentities,
  listRootIdentityOrganizations,
  loadRootIdentity,
  type RootIdentitiesApi,
  type RootIdentitiesPage,
  type RootIdentitiesQueryInput,
  type RootIdentityDetail,
  type RootIdentityOrganization,
  type RootRequestOutcome,
} from "../../workflows/root";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
} from "../../workflows/runtimeInput";

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

/**
 * What the facade needs from the runtime: the current auth snapshot, the
 * signing identity (which can change or vanish without touching the session),
 * and the api client. Narrower than the full runtime so tests can drive it
 * with a fake.
 */
export interface RootRuntime {
  workflowInput(): {
    readonly apiClient: RootIdentitiesApi;
    readonly auth: WorkflowRuntimeAuthInput;
    readonly crypto: Pick<WorkflowRuntimeCryptoInput, "signingFingerprint">;
  };
}

const NOT_AVAILABLE: RootRequestOutcome<never> = {
  message: "The current session is not a platform operator.",
  ok: false,
  status: null,
};

const SESSION_CHANGED: RootRequestOutcome<never> = {
  message: "The session changed while the request was in flight.",
  ok: false,
  status: null,
};

export function createRoot(runtimeService: RootRuntime): Root {
  const activeApi = (): RootIdentitiesApi | null => {
    const runtime = runtimeService.workflowInput();
    return runtime.auth.isAuthenticated && runtime.auth.isRoot === true
      ? runtime.apiClient
      : null;
  };

  // Operator data must never surface into a session other than the one that
  // asked for it. The reply is kept only while the same user and the same
  // signing identity are still root: a logout, an identity switch, or a
  // key-pair swap or destruction drops it. An automatic auth-token renewal
  // changes neither, so a successful retried lookup is still returned.
  const principal = () => {
    const runtime = runtimeService.workflowInput();
    return {
      fingerprint: runtime.crypto.signingFingerprint,
      userId: runtime.auth.userId,
    };
  };
  const guarded = async <Data>(
    request: (api: RootIdentitiesApi) => Promise<RootRequestOutcome<Data>>,
  ): Promise<RootRequestOutcome<Data>> => {
    const api = activeApi();
    if (!api) {
      return NOT_AVAILABLE;
    }
    const before = principal();
    const outcome = await request(api);
    const after = principal();
    if (
      activeApi() === null ||
      after.userId !== before.userId ||
      after.fingerprint !== before.fingerprint
    ) {
      return SESSION_CHANGED;
    }
    return outcome;
  };

  return {
    get isAvailable() {
      return activeApi() !== null;
    },
    listIdentities: (query) => guarded((api) => listRootIdentities(api, query)),
    listIdentityOrganizations: (userId) =>
      guarded((api) => listRootIdentityOrganizations(api, userId)),
    loadIdentity: (userId) => guarded((api) => loadRootIdentity(api, userId)),
  };
}
