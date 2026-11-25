import { createListenerSet } from "../../data/shared/listenerSet";
import {
  bootstrapRootContainer,
  registerIdentity as registerIdentityWorkflow,
  removeNativeSubscriptionRestoreProvisioningAttempt,
} from "../../workflows/registration";
import type { ClearRemoteSyncStateResult } from "../../workflows/sync";
import {
  emptySessionSnapshot,
  hostSessionUpdate,
  mergeSessionContext,
  registrationSessionResult,
  sessionSnapshotsEqual,
} from "./sessionContext";
import {
  currentKeyBoundUserId,
  registrationKeyAlreadyBound,
  requireRegistrationIdentityPinner,
  requireSessionTrustDomain,
  SessionIdentityAcknowledgments,
} from "./sessionIdentityTrust";
import {
  type SessionTransition,
  sessionBoundary,
  sessionLifetime,
} from "./sessionLifetime";
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
  private refusedSignIn: number | null = null;
  private snapshotValue = emptySessionSnapshot();

  constructor(private readonly dependencies: SessionDependencies) {}

  captureSignIn(purpose?: "restore"): () => boolean {
    return sessionLifetime(this).currentSignIn(purpose);
  }

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
    const signInCurrent = this.captureSignIn();
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
    if (!signInCurrent() || !isCurrent())
      throw new Error("Identity change was superseded.");
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
      this.clearAuthentication(true);
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
    this.clearAuthentication(false);
  }

  clearAuthentication(renewal: boolean): void {
    if (renewal) this.refusedSignIn = sessionLifetime(this).signInRevision;
    this.commitContext(
      { authToken: null, isAuthenticated: false, isRoot: false },
      renewal ? "renewal-refused" : "boundary",
    );
  }

  async logoutRemote(
    onLocalLogout?: (current: () => boolean) => void | Promise<void>,
  ): Promise<boolean> {
    const identitySnapshot = this.dependencies.identity.snapshot;
    const lifetime = sessionLifetime(this);
    const revision = lifetime.signInRevision;
    try {
      if (!this.authToken) {
        return true;
      }

      const response = await this.dependencies.api.logout();
      return response?.message === "ok";
    } finally {
      const sameIdentity = () =>
        this.dependencies.identity.snapshot === identitySnapshot;
      const clearedHere =
        sameIdentity() && revision === lifetime.signInRevision;
      if (clearedHere) this.logout();
      // The same local sign-out may already have happened during a refused
      // renewal. A later explicit logout or sign-in supersedes this cleanup.
      const current = () =>
        sameIdentity() &&
        !this.isAuthenticated &&
        lifetime.signInRevision === revision + 1;
      if (current() && (clearedHere || this.refusedSignIn === revision))
        await onLocalLogout?.(current);
    }
  }

  boundUserId = () => currentKeyBoundUserId(this.dependencies);

  async registerIdentity(
    options: RegisterIdentityOptions,
  ): Promise<SessionRegistrationResult | SessionRegistrationRefusal | null> {
    const containerId = this.containerId;
    if (!containerId) {
      this.dependencies.log(
        "Registration skipped: container id is unavailable",
      );
      return null;
    }

    const identitySnapshot = this.dependencies.identity.snapshot;
    const sessionCurrent = this.captureSignIn();
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
      isCurrent,
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
        ...options,
        identityTrustDomain: requireSessionTrustDomain(this.dependencies),
        apiClient: this.dependencies.api,
        containerId,
        dbClient,
        documentProjectors: this.dependencies.documentProjectors,
        encapsulationKeyPair,
        isIdentityCurrent: isCurrent,
        log: this.dependencies.log,
        logError: this.dependencies.logError,
        pinLocalUserIdentity,
        primeProvisionedState: this.dependencies.primeProvisionedState,
        provisionedSystemContainers:
          this.dependencies.provisionedSystemContainers,
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
    if (authToken === null) this.logout();
    else this.setSnapshot({ ...this.snapshotValue, authToken });
  }

  setContainerId(containerId: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, containerId });
  }

  setContext(context: SessionContext): void {
    this.commitContext(...hostSessionUpdate(context));
  }

  commitContext(
    context: SessionContext,
    kind?: SessionTransition,
    verifiedTicket?: string,
  ): void {
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
      verifiedTicket,
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
    kind?: SessionTransition,
    verifiedTicket?: string,
  ): void {
    const previous = this.snapshotValue;

    const lifetime = sessionLifetime(this);
    const boundary = sessionBoundary(previous, next, kind);
    const retired =
      boundary &&
      lifetime.transition(
        previous.isAuthenticated || previous.authToken !== null,
        next.isAuthenticated,
      );
    if (boundary || previous.authToken !== next.authToken) {
      this.dependencies.api.setAuthToken(next.authToken, {
        verifiedTicket,
        boundary,
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
