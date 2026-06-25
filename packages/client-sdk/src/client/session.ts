import type { ApiClient } from "@tearleads/api-client";
import type { AccountLifecycleResponse } from "@tearleads/validators/response";
import type { DocumentProjectorRegistryInput } from "../data/documents/documentKinds";
import {
  bootstrapRootContainer,
  registerIdentity as registerIdentityWorkflow,
} from "../workflows/registration";
import {
  type ClearRemoteSyncStateResult,
  clearRemoteSyncState as clearRemoteSyncStateWorkflow,
} from "../workflows/sync";
import type { Database } from "./database";
import type { Identity } from "./identity";

export interface SessionContext {
  account?: AccountLifecycleResponse | null | undefined;
  authToken?: string | null | undefined;
  containerId?: string | null | undefined;
  isAuthenticated?: boolean | undefined;
  organizationId?: string | null | undefined;
  userId?: string | null | undefined;
}

export interface SessionSnapshot {
  account: AccountLifecycleResponse | null;
  authToken: string | null;
  containerId: string | null;
  isAuthenticated: boolean;
  organizationId: string | null;
  userId: string | null;
}

export type SessionListener = () => void;

interface SessionDependencies {
  api: ApiClient;
  database: Database;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  identity: Identity;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
}

export interface SessionRegistrationResult {
  readonly account: AccountLifecycleResponse;
  readonly challenge: string;
  readonly containerId: string;
  readonly organizationId: string;
  readonly userId: string;
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
  readonly account: AccountLifecycleResponse | null;
  readonly authToken: string | null;
  readonly containerId: string | null;
  readonly isAuthenticated: boolean;
  readonly organizationId: string | null;
  readonly snapshot: SessionSnapshot;
  readonly userId: string | null;
  bootstrapLocalRootContainer(): Promise<{
    containerId: string;
    created: boolean;
  }>;
  clearRemoteSyncState(): Promise<ClearRemoteSyncStateResult>;
  destroySession(sessionId: string): Promise<boolean>;
  listSessions(): Promise<UserSession[]>;
  login(challengeHex?: string | undefined): Promise<boolean>;
  logout(): void;
  logoutRemote(): Promise<boolean>;
  registerIdentity(): Promise<SessionRegistrationResult | null>;
  setAuthToken(authToken: string | null): void;
  setContainerId(containerId: string | null): void;
  setContext(context: SessionContext): void;
  setOrganizationId(organizationId: string | null): void;
  setUserId(userId: string | null): void;
  subscribe(listener: SessionListener): () => void;
}

export function createSession(dependencies: SessionDependencies): Session {
  return new SessionService(dependencies);
}

function sameAccountLifecycle(
  left: AccountLifecycleResponse | null,
  right: AccountLifecycleResponse | null,
): boolean {
  return (
    left?.status === right?.status &&
    left?.trialEndsAt === right?.trialEndsAt &&
    left?.disabledAt === right?.disabledAt &&
    left?.purgeAfter === right?.purgeAfter &&
    left?.purgeStartedAt === right?.purgeStartedAt &&
    left?.purgedAt === right?.purgedAt &&
    left?.remoteDataEpoch === right?.remoteDataEpoch
  );
}

class SessionService implements Session {
  private readonly listeners = new Set<SessionListener>();
  private snapshotValue: SessionSnapshot = {
    account: null,
    authToken: null,
    containerId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null,
  };

  constructor(private readonly dependencies: SessionDependencies) {}

  get account(): AccountLifecycleResponse | null {
    return this.snapshotValue.account;
  }

  get authToken(): string | null {
    return this.snapshotValue.authToken;
  }

  get containerId(): string | null {
    return this.snapshotValue.containerId;
  }

  get isAuthenticated(): boolean {
    return this.snapshotValue.isAuthenticated;
  }

  get organizationId(): string | null {
    return this.snapshotValue.organizationId;
  }

  get snapshot(): SessionSnapshot {
    return this.snapshotValue;
  }

  get userId(): string | null {
    return this.snapshotValue.userId;
  }

  async bootstrapLocalRootContainer(): Promise<{
    containerId: string;
    created: boolean;
  }> {
    const result = await bootstrapRootContainer(
      this.dependencies.database.requireExecSql("bootstrapLocalRootContainer"),
    );
    this.setContainerId(result.containerId);
    if (result.created) {
      this.dependencies.log("Root container created");
    }
    return result;
  }

  async listSessions(): Promise<UserSession[]> {
    const response = await this.dependencies.api.listSessions();
    if (!response) {
      return [];
    }

    return response.sessions.map(
      ({
        createdAt,
        id,
        ipAddresses,
        isCurrent,
        lastActiveAt,
        lastActiveIp,
        signingKeyFingerprint,
      }) => ({
        createdAt,
        id,
        ipAddresses,
        isCurrent,
        lastActiveAt,
        lastActiveIp,
        signingKeyFingerprint,
      }),
    );
  }

  async clearRemoteSyncState(): Promise<ClearRemoteSyncStateResult> {
    const result = await clearRemoteSyncStateWorkflow(
      this.dependencies.database.requireExecSql("clearRemoteSyncState"),
    );
    this.dependencies.api.clearWriterProjectionCaches();
    this.setContext({ organizationId: null });
    this.dependencies.log("Remote sync state cleared");
    return result;
  }

  async destroySession(sessionId: string): Promise<boolean> {
    const response = await this.dependencies.api.destroySession(sessionId);
    return response?.message === "ok";
  }

  async login(challengeHex?: string | undefined): Promise<boolean> {
    const signingKeyPair =
      this.dependencies.identity.requireSigningKeyPair("login");
    const fingerprint =
      (await this.dependencies.identity.refreshSigningFingerprint()) ?? null;

    if (!fingerprint) {
      return false;
    }

    this.dependencies.log(
      challengeHex ? "Authenticating with challenge..." : "Authenticating...",
    );
    const authentication = challengeHex
      ? await this.dependencies.api.authenticateWithChallenge(
          fingerprint,
          signingKeyPair.signingPrivateKey,
          challengeHex,
        )
      : await this.dependencies.api.authenticate(
          fingerprint,
          signingKeyPair.signingPrivateKey,
        );

    if (!authentication) {
      this.setContext({
        account: null,
        authToken: null,
        isAuthenticated: false,
      });
      this.dependencies.log("Authentication failed");
      return false;
    }

    this.setContext({
      account: authentication.account,
      authToken: authentication.token,
      isAuthenticated: true,
      organizationId: authentication.organizationId,
      userId: authentication.userId,
    });
    this.dependencies.log("Authentication successful");
    return true;
  }

  logout(): void {
    this.setContext({ account: null, authToken: null, isAuthenticated: false });
  }

  async logoutRemote(): Promise<boolean> {
    try {
      if (!this.authToken) {
        return true;
      }

      const response = await this.dependencies.api.logout();
      return response?.message === "ok";
    } finally {
      this.logout();
    }
  }

  async registerIdentity(): Promise<SessionRegistrationResult | null> {
    const containerId = this.containerId;
    if (!containerId) {
      this.dependencies.log(
        "Registration skipped: container id is unavailable",
      );
      return null;
    }

    const signingKeyPair = this.dependencies.identity.signingKeyPair;
    if (!signingKeyPair) {
      this.dependencies.log("Registration skipped: signing key is unavailable");
      return null;
    }

    const encapsulationKeyPair =
      this.dependencies.identity.encapsulationKeyPair;
    if (!encapsulationKeyPair) {
      this.dependencies.log(
        "Registration skipped: encapsulation key is unavailable",
      );
      return null;
    }

    const dbClient = this.dependencies.database.client;
    if (!dbClient) {
      this.dependencies.log(
        "Registration skipped: database client is unavailable",
      );
      return null;
    }

    let response: Awaited<ReturnType<typeof registerIdentityWorkflow>>;
    try {
      response = await registerIdentityWorkflow({
        apiClient: this.dependencies.api,
        containerId,
        dbClient,
        documentProjectors: this.dependencies.documentProjectors,
        encapsulationKeyPair,
        log: this.dependencies.log,
        logError: this.dependencies.logError,
        signingKeyPair,
      });
    } catch (error: unknown) {
      this.dependencies.logError("Identity registration failed", error);
      throw error;
    }

    if (!response) {
      this.dependencies.log("Registration failed");
      return null;
    }

    this.setContext({
      account: response.account,
      containerId: response.rootContainerId,
      organizationId: response.organizationId,
      userId: response.userId,
    });

    return {
      account: response.account,
      challenge: response.challenge,
      containerId: response.rootContainerId,
      organizationId: response.organizationId,
      userId: response.userId,
    };
  }

  setAuthToken(authToken: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, authToken });
  }

  setContainerId(containerId: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, containerId });
  }

  setContext(context: SessionContext): void {
    this.setSnapshot({
      account:
        "account" in context
          ? (context.account ?? null)
          : this.snapshotValue.account,
      authToken:
        "authToken" in context
          ? (context.authToken ?? null)
          : this.snapshotValue.authToken,
      containerId:
        "containerId" in context
          ? (context.containerId ?? null)
          : this.snapshotValue.containerId,
      isAuthenticated:
        "isAuthenticated" in context
          ? (context.isAuthenticated ?? false)
          : this.snapshotValue.isAuthenticated,
      organizationId:
        "organizationId" in context
          ? (context.organizationId ?? null)
          : this.snapshotValue.organizationId,
      userId:
        "userId" in context
          ? (context.userId ?? null)
          : this.snapshotValue.userId,
    });
  }

  setOrganizationId(organizationId: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, organizationId });
  }

  setUserId(userId: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, userId });
  }

  subscribe = (listener: SessionListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Keep one subscriber failure from blocking later subscribers.
      }
    }
  }

  private setSnapshot(next: SessionSnapshot): void {
    const previous = this.snapshotValue;
    if (previous.authToken !== next.authToken) {
      this.dependencies.api.setAuthToken(next.authToken);
    }

    if (
      sameAccountLifecycle(previous.account, next.account) &&
      previous.authToken === next.authToken &&
      previous.containerId === next.containerId &&
      previous.isAuthenticated === next.isAuthenticated &&
      previous.organizationId === next.organizationId &&
      previous.userId === next.userId
    ) {
      return;
    }

    this.snapshotValue = next;
    this.notifyListeners();
  }
}
