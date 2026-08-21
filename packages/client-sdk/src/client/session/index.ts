import type { ApiClient } from "@symcrypt/api-client";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import { createOrganization as createOrganizationWorkflow } from "../../workflows/organizations";
import {
  bootstrapRootContainer,
  type ProvisionedSystemContainerSpec,
  registerIdentity as registerIdentityWorkflow,
} from "../../workflows/registration";
import {
  type ClearRemoteSyncStateResult,
  clearRemoteSyncState as clearRemoteSyncStateWorkflow,
} from "../../workflows/sync";
import type { Database } from "../database";
import type { Identity } from "../identity";
import { createListenerSet } from "../listenerSet";
import {
  requireRegistrationIdentityPinner,
  requireUserIdentityAvailable,
  type UserIdentityAvailable,
} from "./sessionIdentityTrust";
import type {
  CreateOrganizationOptions,
  RegisterIdentityOptions,
  Session,
  SessionContext,
  SessionCreateOrganizationResult,
  SessionListener,
  SessionRegistrationResult,
  SessionSnapshot,
  UserSession,
} from "./sessionTypes";

interface SessionDependencies {
  api: ApiClient;
  database: Database;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  identity: Identity;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  onUserIdentityAvailable?: UserIdentityAvailable | undefined;
  /** App-owned system containers provisioned with each new organization. */
  provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
}

export function createSession(dependencies: SessionDependencies): Session {
  return new SessionService(dependencies);
}

class SessionService implements Session {
  private readonly listeners = createListenerSet();
  private syncEnabledValue = true;
  private snapshotValue: SessionSnapshot = {
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null,
  };

  constructor(private readonly dependencies: SessionDependencies) {}

  get authToken(): string | null {
    return this.snapshotValue.authToken;
  }

  get containerId(): string | null {
    return this.snapshotValue.containerId;
  }

  get defaultOrganizationId(): string | null {
    return this.snapshotValue.defaultOrganizationId;
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

  get syncEnabled(): boolean {
    return this.syncEnabledValue;
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
    const identitySnapshot = this.dependencies.identity.snapshot;
    const encapsulationKeyPair = identitySnapshot.encapsulationKeyPair;
    if (!encapsulationKeyPair) {
      return false;
    }
    if (identitySnapshot.signingKeyPair !== signingKeyPair) {
      return false;
    }
    const pinLocalUserIdentity = requireUserIdentityAvailable(
      this.dependencies.onUserIdentityAvailable,
      "Login",
    );

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

    if (this.dependencies.identity.snapshot !== identitySnapshot) {
      return false;
    }

    if (!authentication) {
      this.setContext({
        authToken: null,
        isAuthenticated: false,
      });
      this.dependencies.log("Authentication failed");
      return false;
    }

    try {
      await pinLocalUserIdentity(authentication.userId, {
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        signingKeyFingerprint: fingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      });
    } catch (error) {
      this.setContext({ authToken: null, isAuthenticated: false });
      throw error;
    }
    if (this.dependencies.identity.snapshot !== identitySnapshot) {
      return false;
    }
    this.setContext({
      authToken: authentication.token,
      defaultOrganizationId: authentication.organizationId,
      isAuthenticated: true,
      organizationId: authentication.organizationId,
      userId: authentication.userId,
    });
    this.dependencies.log("Authentication successful");
    return true;
  }

  logout(): void {
    this.setContext({ authToken: null, isAuthenticated: false });
  }

  async logoutRemote(): Promise<boolean> {
    const identitySnapshot = this.dependencies.identity.snapshot;
    try {
      if (!this.authToken) {
        return true;
      }

      const response = await this.dependencies.api.logout();
      return response?.message === "ok";
    } finally {
      if (this.dependencies.identity.snapshot === identitySnapshot) {
        this.logout();
      }
    }
  }

  async registerIdentity(
    options?: RegisterIdentityOptions,
  ): Promise<SessionRegistrationResult | null> {
    const containerId = this.containerId;
    if (!containerId) {
      this.dependencies.log(
        "Registration skipped: container id is unavailable",
      );
      return null;
    }

    const identitySnapshot = this.dependencies.identity.snapshot;
    const signingKeyPair = identitySnapshot.signingKeyPair;
    if (!signingKeyPair) {
      this.dependencies.log("Registration skipped: signing key is unavailable");
      return null;
    }

    const encapsulationKeyPair = identitySnapshot.encapsulationKeyPair;
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
    const pinLocalUserIdentity = requireRegistrationIdentityPinner({
      identity: this.dependencies.identity,
      identitySnapshot,
      onUserIdentityAvailable: this.dependencies.onUserIdentityAvailable,
    });

    let response: Awaited<ReturnType<typeof registerIdentityWorkflow>>;
    try {
      response = await registerIdentityWorkflow({
        apiClient: this.dependencies.api,
        containerId,
        dbClient,
        documentProjectors: this.dependencies.documentProjectors,
        encapsulationKeyPair,
        isIdentityCurrent: () =>
          this.dependencies.identity.snapshot === identitySnapshot,
        log: this.dependencies.log,
        logError: this.dependencies.logError,
        organizationProfileName: options?.organizationProfileName,
        pinLocalUserIdentity,
        provisionedSystemContainers:
          this.dependencies.provisionedSystemContainers,
        rosterProfileNickname: options?.rosterProfileNickname,
        signingKeyPair,
      });
    } catch (error: unknown) {
      this.dependencies.logError("Identity registration failed", error);
      throw error;
    }

    if (this.dependencies.identity.snapshot !== identitySnapshot) {
      return null;
    }

    if (!response) {
      this.dependencies.log("Registration failed");
      return null;
    }

    await pinLocalUserIdentity(response.userId, {
      encapsulationPublicKey: encapsulationKeyPair.publicKey,
      signingPublicKey: signingKeyPair.signingPublicKey,
    });
    if (this.dependencies.identity.snapshot !== identitySnapshot) {
      return null;
    }
    this.setContext({
      containerId: response.rootContainerId,
      defaultOrganizationId: response.organizationId,
      organizationId: response.organizationId,
      userId: response.userId,
    });

    return {
      challenge: response.challenge,
      containerId: response.rootContainerId,
      organizationId: response.organizationId,
      userId: response.userId,
    };
  }

  async createOrganization(
    options?: CreateOrganizationOptions,
  ): Promise<SessionCreateOrganizationResult | null> {
    const userId = this.userId;
    if (!userId) {
      this.dependencies.log(
        "Create organization skipped: user id is unavailable",
      );
      return null;
    }

    const identitySnapshot = this.dependencies.identity.snapshot;
    const { encapsulationKeyPair, signingKeyPair } = identitySnapshot;
    if (!signingKeyPair || !encapsulationKeyPair) {
      this.dependencies.log(
        "Create organization skipped: identity keys are unavailable",
      );
      return null;
    }

    const dbClient = this.dependencies.database.client;
    if (!dbClient) {
      this.dependencies.log(
        "Create organization skipped: database client is unavailable",
      );
      return null;
    }

    let response: Awaited<ReturnType<typeof createOrganizationWorkflow>>;
    try {
      response = await createOrganizationWorkflow({
        apiClient: this.dependencies.api,
        dbClient,
        documentProjectors: this.dependencies.documentProjectors,
        encapsulationKeyPair,
        isIdentityCurrent: () =>
          this.dependencies.identity.snapshot === identitySnapshot,
        log: this.dependencies.log,
        logError: this.dependencies.logError,
        organizationProfileName: options?.organizationProfileName,
        provisionedSystemContainers:
          this.dependencies.provisionedSystemContainers,
        rosterProfileNickname: options?.rosterProfileNickname,
        signingKeyPair,
        userId,
      });
    } catch (error: unknown) {
      this.dependencies.logError("Organization creation failed", error);
      throw error;
    }

    if (this.dependencies.identity.snapshot !== identitySnapshot) {
      return null;
    }

    if (!response) {
      this.dependencies.log("Organization creation failed");
      return null;
    }

    // Creating an organization does not switch the active organization.
    return {
      containerId: response.rootContainerId,
      organizationId: response.organizationId,
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
      authToken:
        "authToken" in context
          ? (context.authToken ?? null)
          : this.snapshotValue.authToken,
      containerId:
        "containerId" in context
          ? (context.containerId ?? null)
          : this.snapshotValue.containerId,
      defaultOrganizationId:
        "defaultOrganizationId" in context
          ? (context.defaultOrganizationId ?? null)
          : this.snapshotValue.defaultOrganizationId,
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

  setSyncEnabled(enabled: boolean): void {
    if (this.syncEnabledValue === enabled) {
      return;
    }
    this.syncEnabledValue = enabled;
    this.listeners.notify();
  }

  setUserId(userId: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, userId });
  }

  subscribe = (listener: SessionListener): (() => void) =>
    this.listeners.subscribe(listener);

  private setSnapshot(next: SessionSnapshot): void {
    const previous = this.snapshotValue;
    if (previous.authToken !== next.authToken) {
      this.dependencies.api.setAuthToken(next.authToken);
    }

    if (
      previous.authToken === next.authToken &&
      previous.containerId === next.containerId &&
      previous.defaultOrganizationId === next.defaultOrganizationId &&
      previous.isAuthenticated === next.isAuthenticated &&
      previous.organizationId === next.organizationId &&
      previous.userId === next.userId
    ) {
      return;
    }

    this.snapshotValue = next;
    this.listeners.notify();
  }
}
