import type { ApiClient } from "@tearleads/api-client";
import {
  bootstrapRootContainer,
  registerIdentity as registerIdentityWorkflow,
} from "../workflows/registration";
import type { TearleadsDatabase } from "./database";
import type { TearleadsIdentity } from "./identity";

export interface TearleadsSessionContext {
  authToken?: string | null | undefined;
  containerId?: string | null | undefined;
  isAuthenticated?: boolean | undefined;
  organizationId?: string | null | undefined;
  userId?: string | null | undefined;
}

export interface TearleadsSessionSnapshot {
  authToken: string | null;
  containerId: string | null;
  isAuthenticated: boolean;
  organizationId: string | null;
  userId: string | null;
}

export type TearleadsSessionListener = () => void;

interface TearleadsSessionDependencies {
  api: ApiClient;
  database: TearleadsDatabase;
  identity: TearleadsIdentity;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
}

export interface TearleadsSessionRegistrationResult {
  readonly challenge: string;
  readonly containerId: string;
  readonly organizationId: string;
  readonly userId: string;
}

export interface TearleadsUserSession {
  readonly createdAt: string;
  readonly id: string;
  readonly isCurrent: boolean;
  readonly signingKeyFingerprint: string;
}

export interface TearleadsSession {
  readonly authToken: string | null;
  readonly containerId: string | null;
  readonly isAuthenticated: boolean;
  readonly organizationId: string | null;
  readonly snapshot: TearleadsSessionSnapshot;
  readonly userId: string | null;
  bootstrapLocalRootContainer(): Promise<{
    containerId: string;
    created: boolean;
  }>;
  destroySession(sessionId: string): Promise<boolean>;
  listSessions(): Promise<TearleadsUserSession[]>;
  login(challengeHex?: string | undefined): Promise<boolean>;
  logout(): void;
  logoutRemote(): Promise<boolean>;
  registerIdentity(): Promise<TearleadsSessionRegistrationResult | null>;
  setAuthToken(authToken: string | null): void;
  setContainerId(containerId: string | null): void;
  setContext(context: TearleadsSessionContext): void;
  setOrganizationId(organizationId: string | null): void;
  setUserId(userId: string | null): void;
  subscribe(listener: TearleadsSessionListener): () => void;
}

export function createTearleadsSession(
  dependencies: TearleadsSessionDependencies,
): TearleadsSession {
  return new TearleadsSessionService(dependencies);
}

class TearleadsSessionService implements TearleadsSession {
  private readonly listeners = new Set<TearleadsSessionListener>();
  private snapshotValue: TearleadsSessionSnapshot = {
    authToken: null,
    containerId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null,
  };

  constructor(private readonly dependencies: TearleadsSessionDependencies) {}

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

  get snapshot(): TearleadsSessionSnapshot {
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
      this.dependencies.database.requireClient("bootstrapLocalRootContainer"),
    );
    this.setContainerId(result.containerId);
    if (result.created) {
      this.dependencies.log("Root container created");
    }
    return result;
  }

  async listSessions(): Promise<TearleadsUserSession[]> {
    const response = await this.dependencies.api.listSessions();
    if (!response) {
      return [];
    }

    return response.sessions.map(
      ({ createdAt, id, isCurrent, signingKeyFingerprint }) => ({
        createdAt,
        id,
        isCurrent,
        signingKeyFingerprint,
      }),
    );
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
    const token = challengeHex
      ? await this.dependencies.api.authenticateWithChallenge(
          fingerprint,
          signingKeyPair.signingPrivateKey,
          challengeHex,
        )
      : await this.dependencies.api.authenticate(
          fingerprint,
          signingKeyPair.signingPrivateKey,
        );

    if (!token) {
      this.setContext({ authToken: null, isAuthenticated: false });
      this.dependencies.log("Authentication failed");
      return false;
    }

    this.setContext({ authToken: token, isAuthenticated: true });
    this.dependencies.log("Authentication successful");
    return true;
  }

  logout(): void {
    this.setContext({ authToken: null, isAuthenticated: false });
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

  async registerIdentity(): Promise<TearleadsSessionRegistrationResult | null> {
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
      containerId: response.rootContainerId,
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

  setAuthToken(authToken: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, authToken });
  }

  setContainerId(containerId: string | null): void {
    this.setSnapshot({ ...this.snapshotValue, containerId });
  }

  setContext(context: TearleadsSessionContext): void {
    this.setSnapshot({
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

  subscribe = (listener: TearleadsSessionListener): (() => void) => {
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

  private setSnapshot(next: TearleadsSessionSnapshot): void {
    const previous = this.snapshotValue;
    if (previous.authToken !== next.authToken) {
      this.dependencies.api.setAuthToken(next.authToken);
    }

    if (
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
