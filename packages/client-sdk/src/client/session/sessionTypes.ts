import type { ApiClient } from "@tearleads/api-client";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import type { SecurityIncidentReporter } from "../../data/shared/securityIncidents";
import type { ProvisionedSystemContainerSpec } from "../../workflows/registration";
import type { ProvisionedStatePrimer } from "../../workflows/registration/provisionedStatePrimer";
import type { ClearRemoteSyncStateResult } from "../../workflows/sync";
import type { Identity } from "../identity";
import type { Database } from "../runtime/database";
import type {
  BoundUserIdLookup,
  SessionRegistrationRefusal,
  UserIdentityAvailable,
} from "./sessionIdentityTrust";

export type { SessionRegistrationRefusal } from "./sessionIdentityTrust";

export interface SessionDependencies {
  identityTrustDomain: string | null;
  api: ApiClient;
  database: Database;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  identity: Identity;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  /** The user this device's trust store already binds a signing key to. */
  boundUserIdForSigningKey?: BoundUserIdLookup | undefined;
  onUserIdentityAvailable?: UserIdentityAvailable | undefined;
  /** Seeds what a new organization's committed bootstrap already proves. */
  primeProvisionedState?: ProvisionedStatePrimer | undefined;
  /** App-owned system containers provisioned with each new organization. */
  provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
  /**
   * Records a refused login (a different account than acknowledged) or a
   * refused root acknowledgement; absent in bare test harnesses.
   */
  reportSecurityIncident?: SecurityIncidentReporter | undefined;
}

export interface SessionContext {
  /** Fingerprint-bound host restore only; view selections never acknowledge roots. */
  rootAcknowledgments?: SessionSnapshot["rootAcknowledgments"] | undefined;
  authToken?: string | null | undefined;
  containerId?: string | null | undefined;
  /** Server-backed personal organization; independent of the active org. */
  defaultOrganizationId?: string | null | undefined;
  isAuthenticated?: boolean | undefined;
  /** Platform-operator flag reported by the server at login. */
  isRoot?: boolean | undefined;
  organizationId?: string | null | undefined;
  userId?: string | null | undefined;
}

export interface SessionSnapshot {
  /**
   * Server acknowledgements retained independently of the selected container.
   * Bound to (signing fingerprint, user, organization): once acknowledged, an
   * organization's root id may only be re-acknowledged or reported purged.
   */
  rootAcknowledgments: ReadonlyArray<{
    readonly signingFingerprint: string;
    readonly userId: string;
    readonly organizationId: string;
    readonly rootContainerId: string | null;
  }>;
  authToken: string | null;
  containerId: string | null;
  /** Server-backed personal organization; independent of the active org. */
  defaultOrganizationId: string | null;
  isAuthenticated: boolean;
  /** Platform-operator flag reported by the server at login. */
  isRoot: boolean;
  organizationId: string | null;
  userId: string | null;
}

export type SessionListener = () => void;

export interface SessionRegistrationResult {
  readonly challenge: string;
  readonly containerId: string;
  readonly organizationId: string;
  readonly userId: string;
}

export interface SessionCreateOrganizationResult {
  readonly containerId: string;
  readonly organizationId: string;
}

export interface SessionRecoverOrganizationResult
  extends SessionCreateOrganizationResult {
  readonly reset: ClearRemoteSyncStateResult;
  readonly replacedOrganizationId: string;
}

export interface CreateOrganizationOptions {
  /** Overrides the seeded organization profile name; see registration. */
  readonly organizationProfileName?: string | undefined;
  /** Overrides the seeded self roster-profile nickname; see registration. */
  readonly rosterProfileNickname?: string | undefined;
}

export interface RegisterIdentityOptions {
  /**
   * The Privacy Policy and Terms of Service revision the user agreed to before
   * this registration: `LEGAL_TERMS_VERSION` once they have seen it and
   * agreed. The API registers only the current revision and records it, with
   * the time of registration, on the identity.
   */
  readonly acceptedLegalTermsVersion: string;
  /**
   * Overrides the seeded personal-organization profile name. Optional; when
   * omitted the default personal-org name is used. The demo host passes each
   * pane's peer-labeled org name ("Peer 1's Org").
   */
  readonly organizationProfileName?: string | undefined;
  /**
   * Overrides the seeded self roster-profile nickname. Optional; when omitted
   * the default ("You") is used. The demo host passes each pane's peer-labeled
   * self name ("Peer 1 (You)").
   */
  readonly rosterProfileNickname?: string | undefined;
}

export interface UserSession {
  readonly createdAt: string;
  readonly id: string;
  readonly ipAddresses: string[];
  readonly isCurrent: boolean;
  readonly lastActiveAt: string;
  readonly lastActiveIp: string | null;
  readonly signingKeyFingerprint: string;
}

export interface Session {
  readonly authToken: string | null;
  readonly containerId: string | null;
  /** Server-backed personal organization; independent of the active org. */
  readonly defaultOrganizationId: string | null;
  readonly isAuthenticated: boolean;
  /**
   * Platform-operator flag reported by the server at login. It only decides
   * whether the root console is offered; the API enforces root access itself.
   */
  readonly isRoot: boolean;
  readonly organizationId: string | null;
  readonly snapshot: SessionSnapshot;
  /** Controls server replication without changing network connectivity. */
  readonly syncEnabled: boolean;
  readonly userId: string | null;
  /**
   * Whether `userId` was acknowledged by the server for the active signing
   * identity (a successful login or a fingerprint-bound host restore). A user
   * ID chosen locally through `setUserId` is not, and hosts must not persist
   * it as this identity's account.
   */
  readonly userIdAcknowledged: boolean;
  /** Stable predicate for this sign-in, including after verified renewal. */
  captureSignIn(purpose?: "restore"): () => boolean;
  bootstrapLocalRootContainer(isCurrent?: () => boolean): Promise<{
    containerId: string;
    created: boolean;
  }>;
  clearRemoteSyncState(
    organizationId: string,
  ): Promise<ClearRemoteSyncStateResult>;
  createOrganization(
    options?: CreateOrganizationOptions,
  ): Promise<SessionCreateOrganizationResult | null>;
  completeNativeSubscriptionRestoreOrganization(
    organizationId: string,
  ): Promise<boolean>;
  destroySession(sessionId: string): Promise<boolean>;
  listSessions(): Promise<UserSession[]>;
  login(challengeHex?: string | undefined): Promise<boolean>;
  logout(): void;
  /** Runs host cleanup only after this invocation clears its own local session. */
  logoutRemote(
    onLocalLogout?: (current: () => boolean) => void | Promise<void>,
  ): Promise<boolean>;
  prepareNativeSubscriptionRestoreOrganization(
    options?: CreateOrganizationOptions,
  ): Promise<SessionCreateOrganizationResult | null>;
  registerIdentity(
    options: RegisterIdentityOptions,
  ): Promise<SessionRegistrationResult | SessionRegistrationRefusal | null>;
  recoverPurgedOrganization(
    organizationId: string,
    options?: CreateOrganizationOptions,
  ): Promise<SessionRecoverOrganizationResult | null>;
  setAuthToken(authToken: string | null): void;
  setContainerId(containerId: string | null): void;
  /** A host restore supplying both isAuthenticated and its token begins a
   * sign-in. Partial view updates preserve it. User acknowledgments must match. */
  setContext(context: SessionContext): void;
  setOrganizationId(organizationId: string | null): void;
  setSyncEnabled(enabled: boolean): void;
  setUserId(userId: string | null): void;
  subscribe(listener: SessionListener): () => void;
}
