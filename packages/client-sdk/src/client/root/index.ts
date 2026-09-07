import {
  listRootIdentities,
  listRootIdentityOrganizations,
  listRootOrganizationIdentities,
  listRootOrganizations,
  loadRootIdentity,
  loadRootOrganization,
  type RootIdentitiesApi,
  type RootIdentitiesPage,
  type RootIdentitiesQueryInput,
  type RootIdentityDetail,
  type RootIdentityOrganization,
  type RootOrganizationDetail,
  type RootOrganizationIdentitiesPage,
  type RootOrganizationPageQueryInput,
  type RootOrganizationsApi,
  type RootOrganizationsPage,
  type RootOrganizationsQueryInput,
  type RootRequestOutcome,
} from "../../workflows/root";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
} from "../../workflows/runtimeInput";
import type { Session } from "../session/sessionTypes";
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
type RootApi = RootIdentitiesApi & RootOrganizationsApi;

export interface Root {
  listOrganizations(
    query?: RootOrganizationsQueryInput,
  ): Promise<RootRequestOutcome<RootOrganizationsPage>>;
  loadOrganization(
    organizationId: string,
  ): Promise<RootRequestOutcome<RootOrganizationDetail>>;
  listOrganizationIdentities(
    organizationId: string,
    query?: RootOrganizationPageQueryInput,
  ): Promise<RootRequestOutcome<RootOrganizationIdentitiesPage>>;
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
 * What the facade needs from the runtime: change notifications, the current
 * auth snapshot, the signing identity (which can change or vanish without
 * touching the session), and the api client. Narrower than the full runtime
 * so tests can drive it with a fake.
 */
export interface RootRuntime {
  /** The session's current auth token; a new one marks a fresh login. */
  authToken(): string | null;
  subscribe(listener: () => void): () => void;
  workflowInput(): {
    readonly apiClient: RootApi;
    readonly auth: WorkflowRuntimeAuthInput;
    readonly crypto: Pick<WorkflowRuntimeCryptoInput, "signingFingerprint">;
  };
}

/** The SDK's internal runtime, narrowed to what the root facade observes. */
export function rootRuntimeOf(
  runtime: Pick<InternalRuntime, "publicRuntime" | "workflowInput">,
  session: Pick<Session, "authToken">,
): RootRuntime {
  return {
    authToken: () => session.authToken,
    subscribe: (listener) => runtime.publicRuntime.subscribe(listener),
    workflowInput: () => runtime.workflowInput(),
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
  const principal = () => {
    const runtime = runtimeService.workflowInput();
    return {
      fingerprint: runtime.crypto.signingFingerprint,
      isAuthenticated: runtime.auth.isAuthenticated,
      isRoot: runtime.auth.isRoot === true,
      userId: runtime.auth.userId,
    };
  };

  // Root standing belongs to the signing identity that authenticated, not to
  // whichever key pair is loaded now. The fingerprint is bound whenever a
  // login completes, which is observable as a new auth token carrying the
  // server's verdict, or when the session first becomes root. A principal
  // change without a new token (a key swap while the old token lingers)
  // unbinds root until the next login. Every principal change is also
  // counted as it happens, so a round trip such as logout then login, or a
  // switch to another identity and back, is still two changes even though
  // the endpoints match; a token renewal alone changes no principal, so a
  // retried lookup is still returned.
  let observed = principal();
  let observedToken = runtimeService.authToken();
  let boundFingerprint: string | null =
    observed.isAuthenticated && observed.isRoot ? observed.fingerprint : null;
  let lifecycle = 0;
  runtimeService.subscribe(() => {
    const next = principal();
    const token = runtimeService.authToken();
    const freshToken = token !== null && token !== observedToken;
    const wasRoot = observed.isAuthenticated && observed.isRoot;
    const isRootNow = next.isAuthenticated && next.isRoot;
    const changed =
      next.fingerprint !== observed.fingerprint ||
      next.isAuthenticated !== observed.isAuthenticated ||
      next.isRoot !== observed.isRoot ||
      next.userId !== observed.userId;
    if (changed) {
      lifecycle += 1;
    }
    if (!isRootNow) {
      boundFingerprint = null;
    } else if (freshToken || !wasRoot) {
      boundFingerprint = next.fingerprint;
    } else if (changed) {
      boundFingerprint = null;
    }
    observed = next;
    observedToken = token;
  });

  const activeApi = (): RootApi | null => {
    const runtime = runtimeService.workflowInput();
    return runtime.auth.isAuthenticated &&
      runtime.auth.isRoot === true &&
      boundFingerprint !== null &&
      runtime.crypto.signingFingerprint === boundFingerprint
      ? runtime.apiClient
      : null;
  };

  const guarded = async <Data>(
    request: (api: RootApi) => Promise<RootRequestOutcome<Data>>,
  ): Promise<RootRequestOutcome<Data>> => {
    const api = activeApi();
    if (!api) {
      return NOT_AVAILABLE;
    }
    const startedIn = lifecycle;
    const outcome = await request(api);
    if (activeApi() === null || lifecycle !== startedIn) {
      return SESSION_CHANGED;
    }
    return outcome;
  };

  return {
    get isAvailable() {
      return activeApi() !== null;
    },
    listOrganizations: (query) =>
      guarded((api) => listRootOrganizations(api, query)),
    loadOrganization: (organizationId) =>
      guarded((api) => loadRootOrganization(api, organizationId)),
    listOrganizationIdentities: (organizationId, query) =>
      guarded((api) =>
        listRootOrganizationIdentities(api, organizationId, query),
      ),
    listIdentities: (query) => guarded((api) => listRootIdentities(api, query)),
    listIdentityOrganizations: (userId) =>
      guarded((api) => listRootIdentityOrganizations(api, userId)),
    loadIdentity: (userId) => guarded((api) => loadRootIdentity(api, userId)),
  };
}
