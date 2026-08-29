import type { ClearRemoteSyncStateResult } from "../../workflows/sync";

export interface SessionContext {
  authToken?: string | null | undefined;
  containerId?: string | null | undefined;
  /** Server-backed personal organization; independent of the active org. */
  defaultOrganizationId?: string | null | undefined;
  isAuthenticated?: boolean | undefined;
  organizationId?: string | null | undefined;
  userId?: string | null | undefined;
}

export interface SessionSnapshot {
  authToken: string | null;
  containerId: string | null;
  /** Server-backed personal organization; independent of the active org. */
  defaultOrganizationId: string | null;
  isAuthenticated: boolean;
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
  readonly organizationId: string | null;
  readonly snapshot: SessionSnapshot;
  /** Controls server replication without changing network connectivity. */
  readonly syncEnabled: boolean;
  readonly userId: string | null;
  bootstrapLocalRootContainer(): Promise<{
    containerId: string;
    created: boolean;
  }>;
  clearRemoteSyncState(
    organizationId: string,
  ): Promise<ClearRemoteSyncStateResult>;
  createOrganization(
    options?: CreateOrganizationOptions,
  ): Promise<SessionCreateOrganizationResult | null>;
  destroySession(sessionId: string): Promise<boolean>;
  listSessions(): Promise<UserSession[]>;
  login(challengeHex?: string | undefined): Promise<boolean>;
  logout(): void;
  logoutRemote(): Promise<boolean>;
  registerIdentity(
    options?: RegisterIdentityOptions,
  ): Promise<SessionRegistrationResult | null>;
  recoverPurgedOrganization(
    organizationId: string,
    options?: CreateOrganizationOptions,
  ): Promise<SessionRecoverOrganizationResult | null>;
  setAuthToken(authToken: string | null): void;
  setContainerId(containerId: string | null): void;
  setContext(context: SessionContext): void;
  setOrganizationId(organizationId: string | null): void;
  setSyncEnabled(enabled: boolean): void;
  setUserId(userId: string | null): void;
  subscribe(listener: SessionListener): () => void;
}
