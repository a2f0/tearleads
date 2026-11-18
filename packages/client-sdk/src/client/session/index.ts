import { createListenerSet } from "../../data/shared/listenerSet";
import {
  bootstrapRootContainer,
  registerIdentity as registerIdentityWorkflow,
  removeNativeSubscriptionRestoreProvisioningAttempt,
} from "../../workflows/registration";
import type { ClearRemoteSyncStateResult } from "../../workflows/sync";
import {
  emptySessionSnapshot,
  mergeSessionContext,
  registrationSessionResult,
  sessionSnapshotsEqual,
} from "./sessionContext";
import {
  registrationKeyAlreadyBound,
  requireRegistrationIdentityPinner,
  requireSessionTrustDomain,
  SessionIdentityAcknowledgments,
} from "./sessionIdentityTrust";
import { sessionLifetime } from "./sessionLifetime";
import { userSessionsFromResponse } from "./sessionListing";
import { authenticateSession } from "./sessionLogin";
import { createSessionOrganization } from "./sessionOrganizationCreation";
import {
  clearSessionRemoteSyncState,
  recoverPurgedSessionOrganization,
} from "./sessionPurgeRecovery";
import {
  acknowledgedSessionRoot,
  commitSessionRootAcknowledgment,
} from "./sessionRootAuthority";
import type {
  CreateOrganizationOptions,
  RegisterIdentityOptions,
  Session,
  SessionContext,
  SessionCreateOrganizationResult,
  SessionDependencies,
  SessionListener,
  SessionRecoverOrganizationResult,
  SessionRegistrationRefusal,
  SessionRegistrationResult,
  SessionSnapshot,
  UserSession,
} from "./sessionTypes";

export { sessionLifetime } from "./sessionLifetime";

export function createSession(
  dependencies: SessionDependencies,
): Session & { renewExpired(): Promise<boolean> } {
  return new SessionService(dependencies);
}

class SessionService implements Session {
  private readonly identityAcknowledgments =
    new SessionIdentityAcknowledgments();
  private readonly listeners = createListenerSet();
  private syncEnabledValue = true;
  private snapshotValue = emptySessionSnapshot();

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

  get isRoot(): boolean {
    return this.snapshotValue.isRoot;
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

  get userIdAcknowledged(): boolean {
    return this.identityAcknowledgments.isAcknowledged(
      this.snapshotValue.userId,
      this.dependencies.identity.snapshot.signingFingerprint,
    );
  }

  async bootstrapLocalRootContainer(
    isCurrent: () => boolean = () => true,
  ): ReturnType<typeof bootstrapRootContainer> {
    if (!isCurrent()) throw new Error("Identity change was superseded.");
    // Preserve a logged-in session's acknowledged root during local recovery.
    const acknowledgedRoot = acknowledgedSessionRoot(
      this,
      this.dependencies.identity.snapshot.signingFingerprint,
    );
    if (this.isAuthenticated && acknowledgedRoot) {
      return { containerId: acknowledgedRoot, created: false };
    }
    const result = await bootstrapRootContainer(
      sessionLifetime(this).bind(
        this.dependencies.database.requireExecSql(
          "bootstrapLocalRootContainer",
        ),
      ),
    );
    if (!isCurrent()) throw new Error("Identity change was superseded.");
    this.setContainerId(result.containerId);
    if (result.created) {
      this.dependencies.log("Root container created");
    }
    return result;
  }

  async listSessions(): Promise<UserSession[]> {
    return userSessionsFromResponse(await this.dependencies.api.listSessions());
  }

  async clearRemoteSyncState(
    organizationId: string,
  ): Promise<ClearRemoteSyncStateResult> {
    return clearSessionRemoteSyncState(this.dependencies, this, organizationId);
  }

  async destroySession(sessionId: string): Promise<boolean> {
    const response = await this.dependencies.api.destroySession(sessionId);
    return response?.message === "ok";
  }

  login(challengeHex?: string): Promise<boolean> {
    return authenticateSession(
      this.dependencies,
      this,
      this.identityAcknowledgments,
      challengeHex,
      false,
    );
  }

  renewExpired = (): Promise<boolean> => {
    if (!this.authToken || !this.dependencies.identity.signingKeyPair) {
      this.logout();
      return Promise.resolve(false);
    }
    return authenticateSession(
      this.dependencies,
      this,
      this.identityAcknowledgments,
      undefined,
      true,
    );
  };

  logout(): void {
    this.commitContext(
      { authToken: null, isAuthenticated: false, isRoot: false },
      "boundary",
    );
  }

  async logoutRemote(): Promise<boolean> {
    const identitySnapshot = this.dependencies.identity.snapshot;
    const epoch = sessionLifetime(this).epoch;
    try {
      if (!this.authToken) {
        return true;
      }

      const response = await this.dependencies.api.logout();
      return response?.message === "ok";
    } finally {
      if (
        this.dependencies.identity.snapshot === identitySnapshot &&
        epoch === sessionLifetime(this).epoch
      ) {
        this.logout();
      }
    }
  }

  async registerIdentity(
    options?: RegisterIdentityOptions,
  ): Promise<SessionRegistrationResult | SessionRegistrationRefusal | null> {
    const containerId = this.containerId;
    if (!containerId) {
      this.dependencies.log(
        "Registration skipped: container id is unavailable",
      );
      return null;
    }

    const identitySnapshot = this.dependencies.identity.snapshot;
    const sessionCurrent = sessionLifetime(this).capture();
    const isCurrent = () =>
      sessionCurrent() &&
      this.dependencies.identity.snapshot === identitySnapshot;
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
    const keyBound = await registrationKeyAlreadyBound(
      this.dependencies,
      identitySnapshot.signingFingerprint,
    );
    if (!isCurrent()) return null;
    if (keyBound) return keyBound;

    let response: Awaited<ReturnType<typeof registerIdentityWorkflow>>;
    try {
      response = await registerIdentityWorkflow({
        identityTrustDomain: requireSessionTrustDomain(this.dependencies),
        apiClient: this.dependencies.api,
        containerId,
        dbClient,
        documentProjectors: this.dependencies.documentProjectors,
        encapsulationKeyPair,
        isIdentityCurrent: isCurrent,
        log: this.dependencies.log,
        logError: this.dependencies.logError,
        organizationProfileName: options?.organizationProfileName,
        pinLocalUserIdentity,
        primeProvisionedState: this.dependencies.primeProvisionedState,
        provisionedSystemContainers:
          this.dependencies.provisionedSystemContainers,
        rosterProfileNickname: options?.rosterProfileNickname,
        signingKeyFingerprint: identitySnapshot.signingFingerprint,
        signingKeyPair,
      });
    } catch (error: unknown) {
      this.dependencies.logError("Identity registration failed", error);
      throw error;
    }

    if (!isCurrent()) return null;
    if (!response) {
      this.dependencies.log("Registration failed");
      return null;
    }

    // The workflow pinned `response.userId` once the server confirmed it,
    // under the same currency check as above.
    await commitSessionRootAcknowledgment({
      context: {
        containerId: response.rootContainerId,
        defaultOrganizationId: response.organizationId,
        organizationId: response.organizationId,
        userId: response.userId,
      },
      reporter: this.dependencies.reportSecurityIncident,
      root: response,
      session: this,
      signingFingerprint: identitySnapshot.signingFingerprint,
    });

    return registrationSessionResult(response);
  }

  async createOrganization(
    options?: CreateOrganizationOptions,
    replacesOrganizationId?: string,
    nativeSubscriptionRestore?: boolean,
  ): Promise<SessionCreateOrganizationResult | null> {
    const identitySnapshot = this.dependencies.identity.snapshot;
    const userId = this.userId;
    const isCurrent = sessionLifetime(this).capture();
    const response = await createSessionOrganization(this.dependencies, {
      isCurrent,
      nativeSubscriptionRestore,
      options,
      replacesOrganizationId,
      userId,
    });
    if (
      !response ||
      !isCurrent() ||
      !userId ||
      this.userId !== userId ||
      this.dependencies.identity.snapshot !== identitySnapshot
    )
      return null;
    await commitSessionRootAcknowledgment({
      reporter: this.dependencies.reportSecurityIncident,
      root: {
        userId,
        organizationId: response.organizationId,
        rootContainerId: response.containerId,
      },
      session: this,
      signingFingerprint: identitySnapshot.signingFingerprint,
    });
    return response;
  }

  prepareNativeSubscriptionRestoreOrganization(
    options?: CreateOrganizationOptions,
  ): Promise<SessionCreateOrganizationResult | null> {
    return this.createOrganization(options, undefined, true);
  }

  async completeNativeSubscriptionRestoreOrganization(
    organizationId: string,
  ): Promise<boolean> {
    const userId = this.userId;
    const dbClient = this.dependencies.database.client;
    const identitySnapshot = this.dependencies.identity.snapshot;
    if (!userId || !dbClient) return false;
    const isCurrent = sessionLifetime(this).capture();
    return removeNativeSubscriptionRestoreProvisioningAttempt({
      canCommit: () =>
        isCurrent() &&
        this.userId === userId &&
        this.dependencies.identity.snapshot === identitySnapshot,
      dbClient,
      organizationId,
      userId,
    });
  }

  async recoverPurgedOrganization(
    organizationId: string,
    options?: CreateOrganizationOptions,
  ): Promise<SessionRecoverOrganizationResult | null> {
    return recoverPurgedSessionOrganization(
      this.dependencies,
      this,
      organizationId,
      options,
    );
  }

  setAuthToken(authToken: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, authToken });
  }

  setContainerId(containerId: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, containerId });
  }

  setContext(context: SessionContext): void {
    this.commitContext(context);
  }

  commitContext(context: SessionContext, kind?: "boundary" | "renewal"): void {
    const wasAcknowledged = this.userIdAcknowledged;
    this.identityAcknowledgments.remember(
      context.userId,
      this.dependencies.identity.snapshot.signingFingerprint,
    );
    const previous = this.snapshotValue;
    this.setSnapshot(
      mergeSessionContext(
        previous,
        context,
        this.dependencies.identity.snapshot.signingFingerprint,
      ),
      kind,
    );
    // Acknowledging an already-held userId changes `userIdAcknowledged` without
    // changing the snapshot; persistence subscribers must still observe it.
    if (
      this.snapshotValue === previous &&
      wasAcknowledged !== this.userIdAcknowledged
    ) {
      this.listeners.notify();
    }
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
    this.setSnapshot(
      mergeSessionContext(
        this.snapshotValue,
        { userId },
        this.dependencies.identity.snapshot.signingFingerprint,
      ),
    );
  }

  subscribe = (listener: SessionListener): (() => void) =>
    this.listeners.subscribe(listener);

  private setSnapshot(
    next: SessionSnapshot,
    kind?: "boundary" | "renewal",
  ): void {
    const previous = this.snapshotValue;

    const lifetime = sessionLifetime(this);
    const boundary =
      kind === "boundary" || previous.isAuthenticated !== next.isAuthenticated;
    const retired =
      boundary &&
      lifetime.transition(
        previous.isAuthenticated || previous.authToken !== null,
        next.isAuthenticated,
      );
    if (boundary || previous.authToken !== next.authToken) {
      this.dependencies.api.setAuthToken(next.authToken, {
        newSession: boundary,
      });
    }
    lifetime.lastRenewal = kind === "renewal" ? next : null;
    if (!retired && sessionSnapshotsEqual(previous, next)) {
      return;
    }

    this.snapshotValue = next;
    if (retired) lifetime.onBoundary?.();
    this.listeners.notify();
  }
}
