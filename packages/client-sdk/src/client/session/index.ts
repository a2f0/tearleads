import { removeNativeSubscriptionRestoreProvisioningAttempt } from "../../workflows/organizations/createOrganization";
import {
  bootstrapRootContainer,
  registerIdentity as registerIdentityWorkflow,
} from "../../workflows/registration";
import type { ClearRemoteSyncStateResult } from "../../workflows/sync";
import { createListenerSet } from "../listenerSet";
import {
  emptySessionSnapshot,
  mergeSessionContext,
  sessionSnapshotsEqual,
} from "./sessionContext";
import {
  registrationKeyAlreadyBound,
  requireRegistrationIdentityPinner,
  requireUserIdentityAvailable,
  SessionIdentityAcknowledgments,
} from "./sessionIdentityTrust";
import { userSessionsFromResponse } from "./sessionListing";
import { refuseSessionLogin } from "./sessionLoginRefusal";
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

export function createSession(dependencies: SessionDependencies): Session {
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

  async bootstrapLocalRootContainer(): Promise<{
    containerId: string;
    created: boolean;
  }> {
    // Recovery can request local bootstrap after login. Preserve the root
    // acknowledged by that session instead of replacing it with a local id.
    const acknowledgedRoot = acknowledgedSessionRoot(
      this,
      this.dependencies.identity.snapshot.signingFingerprint,
    );
    if (this.isAuthenticated && acknowledgedRoot) {
      return { containerId: acknowledgedRoot, created: false };
    }
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

  async login(challengeHex?: string | undefined): Promise<boolean> {
    const signingKeyPair =
      this.dependencies.identity.requireSigningKeyPair("login");
    const fingerprint =
      (await this.dependencies.identity.refreshSigningFingerprint()) ?? null;

    if (!fingerprint) {
      return false;
    }
    // A refusal below clears the session it is evidence against; a session
    // another login committed meanwhile is not that session and stays.
    const snapshotAtStart = this.snapshotValue;
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
      this.logout();
      this.dependencies.log("Authentication failed");
      return false;
    }

    try {
      this.identityAcknowledgments.assertMatches(
        authentication.userId,
        fingerprint,
      );
      await pinLocalUserIdentity(authentication.userId, {
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        signingKeyFingerprint: fingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      });
      if (this.dependencies.identity.snapshot !== identitySnapshot)
        return false;
      this.identityAcknowledgments.remember(authentication.userId, fingerprint);
    } catch (error) {
      return refuseSessionLogin(error, authentication.userId, {
        clear: () => this.logout(),
        report: this.dependencies.reportSecurityIncident,
      });
    }
    // A changed root for this identity+org is refused before the token is
    // usable. Decision and commit are one synchronous step against the live
    // snapshot (no await in between); the refusal clears the prior session in
    // that same step and then reports its own incident.
    await commitSessionRootAcknowledgment({
      context: {
        authToken: authentication.token,
        defaultOrganizationId: authentication.organizationId,
        isAuthenticated: true,
        isRoot: authentication.isRoot,
        organizationId: authentication.organizationId,
        userId: authentication.userId,
      },
      onRefused: () => {
        if (this.snapshotValue === snapshotAtStart) this.logout();
      },
      reporter: this.dependencies.reportSecurityIncident,
      root: authentication,
      session: this,
      signingFingerprint: fingerprint,
    });
    this.dependencies.log("Authentication successful");
    return true;
  }

  logout(): void {
    this.setContext({ authToken: null, isAuthenticated: false, isRoot: false });
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
  ): Promise<SessionRegistrationResult | SessionRegistrationRefusal | null> {
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
    const keyBound = await registrationKeyAlreadyBound(
      this.dependencies,
      identitySnapshot.signingFingerprint,
    );
    if (this.dependencies.identity.snapshot !== identitySnapshot) return null;
    if (keyBound) return keyBound;

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
        signingKeyFingerprint: identitySnapshot.signingFingerprint,
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

    return {
      challenge: response.challenge,
      containerId: response.rootContainerId,
      organizationId: response.organizationId,
      userId: response.userId,
    };
  }

  async createOrganization(
    options?: CreateOrganizationOptions,
    replacesOrganizationId?: string,
    nativeSubscriptionRestore?: boolean,
  ): Promise<SessionCreateOrganizationResult | null> {
    const identitySnapshot = this.dependencies.identity.snapshot;
    const userId = this.userId;
    const response = await createSessionOrganization(this.dependencies, {
      nativeSubscriptionRestore,
      options,
      replacesOrganizationId,
      userId,
    });
    if (
      !response ||
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
    return removeNativeSubscriptionRestoreProvisioningAttempt({
      canCommit: () =>
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

  private setSnapshot(next: SessionSnapshot): void {
    const previous = this.snapshotValue;
    if (previous.authToken !== next.authToken) {
      this.dependencies.api.setAuthToken(next.authToken);
    }

    if (sessionSnapshotsEqual(previous, next)) {
      return;
    }

    this.snapshotValue = next;
    this.listeners.notify();
  }
}
