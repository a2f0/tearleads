import type { ApiClient } from "@tearleads/api-client";
import { bootstrapRootContainer } from "../workflows/registration";
import type { TearleadsDatabase } from "./database";
import type { TearleadsIdentity } from "./identity";

export interface TearleadsSessionContext {
  authToken?: string | null | undefined;
  containerId?: string | null | undefined;
  isAuthenticated?: boolean | undefined;
  organizationId?: string | null | undefined;
  userId?: string | null | undefined;
}

interface TearleadsSessionDependencies {
  api: ApiClient;
  database: TearleadsDatabase;
  identity: TearleadsIdentity;
  log: (message: string) => void;
}

export interface TearleadsSession {
  readonly authToken: string | null;
  readonly containerId: string | null;
  readonly isAuthenticated: boolean;
  readonly organizationId: string | null;
  readonly userId: string | null;
  bootstrapLocalRootContainer(): Promise<{
    containerId: string;
    created: boolean;
  }>;
  login(challengeHex?: string | undefined): Promise<boolean>;
  logout(): void;
  setAuthToken(authToken: string | null): void;
  setContainerId(containerId: string | null): void;
  setContext(context: TearleadsSessionContext): void;
  setOrganizationId(organizationId: string | null): void;
  setUserId(userId: string | null): void;
}

export function createTearleadsSession(
  dependencies: TearleadsSessionDependencies,
): TearleadsSession {
  return new TearleadsSessionService(dependencies);
}

class TearleadsSessionService implements TearleadsSession {
  private authTokenValue: string | null = null;
  private containerIdValue: string | null = null;
  private isAuthenticatedValue = false;
  private organizationIdValue: string | null = null;
  private userIdValue: string | null = null;

  constructor(private readonly dependencies: TearleadsSessionDependencies) {}

  get authToken(): string | null {
    return this.authTokenValue;
  }

  get containerId(): string | null {
    return this.containerIdValue;
  }

  get isAuthenticated(): boolean {
    return this.isAuthenticatedValue;
  }

  get organizationId(): string | null {
    return this.organizationIdValue;
  }

  get userId(): string | null {
    return this.userIdValue;
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
      this.setAuthToken(null);
      this.isAuthenticatedValue = false;
      this.dependencies.log("Authentication failed");
      return false;
    }

    this.setAuthToken(token);
    this.isAuthenticatedValue = true;
    this.dependencies.log("Authentication successful");
    return true;
  }

  logout(): void {
    this.setAuthToken(null);
    this.isAuthenticatedValue = false;
  }

  setAuthToken(authToken: string | null): void {
    this.authTokenValue = authToken;
    this.dependencies.api.setAuthToken(authToken);
  }

  setContainerId(containerId: string | null): void {
    this.containerIdValue = containerId;
  }

  setContext(context: TearleadsSessionContext): void {
    if ("authToken" in context) {
      this.setAuthToken(context.authToken ?? null);
    }
    if ("containerId" in context) {
      this.setContainerId(context.containerId ?? null);
    }
    if ("isAuthenticated" in context) {
      this.isAuthenticatedValue = context.isAuthenticated ?? false;
    }
    if ("organizationId" in context) {
      this.organizationIdValue = context.organizationId ?? null;
    }
    if ("userId" in context) {
      this.userIdValue = context.userId ?? null;
    }
  }

  setOrganizationId(organizationId: string | null): void {
    this.organizationIdValue = organizationId;
  }

  setUserId(userId: string | null): void {
    this.userIdValue = userId;
  }
}
