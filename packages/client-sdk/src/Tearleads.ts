import { ApiClient } from "@tearleads/api-client";
import {
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type SigningKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { DocumentProjectorRegistry } from "./data/documents/documentKinds";
import { defaultDocumentProjectorRegistry } from "./data/documents/documentKinds";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  unavailableExecSql,
} from "./data/sqlite/sqlSchema";
import {
  type BlobStore,
  createBlobStore,
  createMemoryBlobStore,
} from "./workflows/blobs";
import {
  type ContactsWorkflowRuntime,
  createContactsWorkflowRuntime,
} from "./workflows/contacts";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
} from "./workflows/documents";
import {
  createExplorerWorkflowRuntime,
  type ExplorerWorkflowRuntime,
} from "./workflows/explorer";
import { cacheReferencedPrincipalPolicies } from "./workflows/principals";
import { bootstrapRootContainer } from "./workflows/registration";

export type TearleadsDatabaseStatus = "idle" | "ready" | "error" | "terminated";

export interface TearleadsDatabaseOptions {
  client?: ExecSqlClientLike | null | undefined;
  execSql?: ExecSql | null | undefined;
  id?: string | null | undefined;
  status?: TearleadsDatabaseStatus | undefined;
}

export interface TearleadsIdentityOptions {
  encapsulationKeyPair?: EncapsulationKeyPair | null | undefined;
  signingFingerprint?: string | null | undefined;
  signingKeyPair?: SigningKeyPair | null | undefined;
}

export interface TearleadsLogger {
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
}

export interface TearleadsOptions {
  apiBaseUrl?: string | undefined;
  apiClient?: ApiClient | undefined;
  blobStore?: BlobStore | undefined;
  database?: TearleadsDatabaseOptions | ExecSqlClientLike | undefined;
  documentProjectors?: DocumentProjectorRegistry | undefined;
  events?: ReadonlyArray<unknown> | undefined;
  identity?: TearleadsIdentityOptions | undefined;
  logger?: TearleadsLogger | undefined;
  online?: boolean | undefined;
}

export interface TearleadsIdentitySnapshot {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

export interface TearleadsSessionContext {
  authToken?: string | null | undefined;
  containerId?: string | null | undefined;
  isAuthenticated?: boolean | undefined;
  organizationId?: string | null | undefined;
  userId?: string | null | undefined;
}

export type TearleadsNetworkListener = (online: boolean) => void;

function defaultOnline(): boolean {
  return typeof navigator === "object" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : true;
}

function logErrorToConsole(message: string | Error, cause?: unknown): void {
  if (cause === undefined) {
    console.error(message);
    return;
  }

  console.error(message, cause);
}

function isDatabaseOptions(
  value: TearleadsDatabaseOptions | ExecSqlClientLike,
): value is TearleadsDatabaseOptions {
  return (
    "client" in value ||
    "execSql" in value ||
    "id" in value ||
    "status" in value
  );
}

function normalizeDatabaseOptions(
  options: TearleadsOptions["database"],
): TearleadsDatabaseOptions | undefined {
  if (!options) {
    return undefined;
  }

  return isDatabaseOptions(options) ? options : { client: options };
}

export class TearleadsDatabase {
  private clientValue: ExecSqlClientLike | null = null;
  private execSqlValue: ExecSql | null = null;
  private idValue: string | null = null;
  private statusValue: TearleadsDatabaseStatus = "idle";

  constructor(options?: TearleadsDatabaseOptions | undefined) {
    if (options) {
      this.configure(options);
    }
  }

  get client(): ExecSqlClientLike | null {
    return this.clientValue;
  }

  get execSql(): ExecSql | null {
    return this.execSqlValue;
  }

  get id(): string | null {
    return this.idValue;
  }

  get status(): TearleadsDatabaseStatus {
    return this.statusValue;
  }

  clear(status: TearleadsDatabaseStatus = "idle"): void {
    this.clientValue = null;
    this.execSqlValue = null;
    this.idValue = null;
    this.statusValue = status;
  }

  configure(options: TearleadsDatabaseOptions): void {
    const client = options.client ?? null;
    const execSql = options.execSql ?? (client ? createExecSql(client) : null);

    this.clientValue = client;
    this.execSqlValue = execSql;
    this.idValue = options.id ?? null;
    this.statusValue = options.status ?? (execSql ? "ready" : "idle");
  }

  requireClient(operation = "This operation"): ExecSqlClientLike {
    if (!this.clientValue) {
      throw new Error(`${operation} requires a configured SQLite client.`);
    }

    return this.clientValue;
  }

  requireExecSql(operation = "This operation"): ExecSql {
    if (!this.execSqlValue) {
      throw new Error(`${operation} requires a configured SQLite executor.`);
    }

    return this.execSqlValue;
  }

  setClient(
    client: ExecSqlClientLike,
    options: Omit<TearleadsDatabaseOptions, "client" | "execSql"> = {},
  ): void {
    this.configure({ ...options, client });
  }

  setExecSql(
    execSql: ExecSql,
    options: Omit<TearleadsDatabaseOptions, "client" | "execSql"> = {},
  ): void {
    this.configure({ ...options, execSql });
  }
}

export class TearleadsBlobs {
  private readonly ephemeralStore = createMemoryBlobStore();
  private identityScoped = false;
  private storeValue: BlobStore;

  constructor(store?: BlobStore | undefined) {
    this.storeValue = store ?? this.ephemeralStore;
  }

  get store(): BlobStore {
    return this.storeValue;
  }

  setStore(store: BlobStore): void {
    this.identityScoped = false;
    this.storeValue = store;
  }

  useEphemeralStore(): void {
    this.identityScoped = false;
    this.storeValue = this.ephemeralStore;
  }

  useIdentityNamespace(signingFingerprint: string): void {
    this.identityScoped = true;
    this.storeValue = createBlobStore(signingFingerprint);
  }

  updateIdentityNamespace(signingFingerprint: string | null): void {
    if (this.identityScoped || this.storeValue === this.ephemeralStore) {
      if (signingFingerprint) {
        this.useIdentityNamespace(signingFingerprint);
        return;
      }

      this.useEphemeralStore();
    }
  }
}

export class TearleadsIdentity {
  private encapsulationKeyPairValue: EncapsulationKeyPair | null;
  private signingFingerprintValue: string | null;
  private signingKeyPairValue: SigningKeyPair | null;

  constructor(
    options: TearleadsIdentityOptions = {},
    private readonly onIdentityChanged: (
      signingFingerprint: string | null,
    ) => void,
    private readonly log: (message: string) => void,
  ) {
    this.encapsulationKeyPairValue = options.encapsulationKeyPair ?? null;
    this.signingFingerprintValue = options.signingFingerprint ?? null;
    this.signingKeyPairValue = options.signingKeyPair ?? null;
    this.onIdentityChanged(this.signingFingerprintValue);
  }

  get encapsulationKeyPair(): EncapsulationKeyPair | null {
    return this.encapsulationKeyPairValue;
  }

  get signingFingerprint(): string | null {
    return this.signingFingerprintValue;
  }

  get signingKeyPair(): SigningKeyPair | null {
    return this.signingKeyPairValue;
  }

  get snapshot(): TearleadsIdentitySnapshot {
    return {
      encapsulationKeyPair: this.encapsulationKeyPairValue,
      signingFingerprint: this.signingFingerprintValue,
      signingKeyPair: this.signingKeyPairValue,
    };
  }

  destroy(): void {
    this.encapsulationKeyPairValue = null;
    this.signingFingerprintValue = null;
    this.signingKeyPairValue = null;
    this.onIdentityChanged(null);
    this.log("Key pair destroyed");
  }

  async generate(): Promise<TearleadsIdentitySnapshot> {
    this.signingKeyPairValue = generateSigningSeedAndKeyPair();
    this.encapsulationKeyPairValue = generateKemSeedAndKeyPair();
    await this.refreshSigningFingerprint();
    this.log("Key pair generated");
    return this.snapshot;
  }

  requireSigningKeyPair(operation = "This operation"): SigningKeyPair {
    if (!this.signingKeyPairValue) {
      throw new Error(`${operation} requires a signing key pair.`);
    }

    return this.signingKeyPairValue;
  }

  async refreshSigningFingerprint(): Promise<string | null> {
    if (!this.signingKeyPairValue) {
      this.signingFingerprintValue = null;
      this.onIdentityChanged(null);
      return null;
    }

    this.signingFingerprintValue = await toFingerprint(
      this.signingKeyPairValue.signingPublicKey,
    );
    this.onIdentityChanged(this.signingFingerprintValue);
    return this.signingFingerprintValue;
  }

  async setKeyPairs(options: {
    encapsulationKeyPair: EncapsulationKeyPair | null;
    signingFingerprint?: string | null | undefined;
    signingKeyPair: SigningKeyPair | null;
  }): Promise<TearleadsIdentitySnapshot> {
    this.encapsulationKeyPairValue = options.encapsulationKeyPair;
    this.signingKeyPairValue = options.signingKeyPair;
    this.signingFingerprintValue = options.signingFingerprint ?? null;

    if (!this.signingFingerprintValue) {
      await this.refreshSigningFingerprint();
    } else {
      this.onIdentityChanged(this.signingFingerprintValue);
    }

    return this.snapshot;
  }
}

export class TearleadsNetwork {
  private readonly listeners = new Set<TearleadsNetworkListener>();
  private onlineValue: boolean;

  constructor(online: boolean = defaultOnline()) {
    this.onlineValue = online;
  }

  get online(): boolean {
    return this.onlineValue;
  }

  setOnline(online: boolean): void {
    if (this.onlineValue === online) {
      return;
    }

    this.onlineValue = online;
    for (const listener of this.listeners) {
      listener(online);
    }
  }

  subscribe = (listener: TearleadsNetworkListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export class TearleadsEvents {
  private eventsValue: ReadonlyArray<unknown>;

  constructor(events: ReadonlyArray<unknown> = []) {
    this.eventsValue = events;
  }

  get events(): ReadonlyArray<unknown> {
    return this.eventsValue;
  }

  clear(): void {
    this.eventsValue = [];
  }

  push(event: unknown): void {
    this.eventsValue = [...this.eventsValue, event];
  }

  setEvents(events: ReadonlyArray<unknown>): void {
    this.eventsValue = events;
  }
}

export class TearleadsSession {
  private authTokenValue: string | null = null;
  private containerIdValue: string | null = null;
  private isAuthenticatedValue = false;
  private organizationIdValue: string | null = null;
  private userIdValue: string | null = null;

  constructor(private readonly client: Tearleads) {}

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
      this.client.db.requireClient("bootstrapLocalRootContainer"),
    );
    this.setContainerId(result.containerId);
    if (result.created) {
      this.client.log("Root container created");
    }
    return result;
  }

  async login(challengeHex?: string | undefined): Promise<boolean> {
    const signingKeyPair = this.client.identity.requireSigningKeyPair("login");
    const fingerprint =
      (await this.client.identity.refreshSigningFingerprint()) ?? null;

    if (!fingerprint) {
      return false;
    }

    this.client.log(
      challengeHex ? "Authenticating with challenge..." : "Authenticating...",
    );
    const token = challengeHex
      ? await this.client.api.authenticateWithChallenge(
          fingerprint,
          signingKeyPair.signingPrivateKey,
          challengeHex,
        )
      : await this.client.api.authenticate(
          fingerprint,
          signingKeyPair.signingPrivateKey,
        );

    if (!token) {
      this.setAuthToken(null);
      this.isAuthenticatedValue = false;
      this.client.log("Authentication failed");
      return false;
    }

    this.setAuthToken(token);
    this.isAuthenticatedValue = true;
    this.client.log("Authentication successful");
    return true;
  }

  logout(): void {
    this.setAuthToken(null);
    this.isAuthenticatedValue = false;
  }

  setAuthToken(authToken: string | null): void {
    this.authTokenValue = authToken;
    this.client.api.setAuthToken(authToken);
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

export class TearleadsWorkflows {
  constructor(private readonly client: Tearleads) {}

  contacts(): ContactsWorkflowRuntime {
    const input = this.client.createWorkflowRuntimeInput();
    return createContactsWorkflowRuntime(input);
  }

  documents(
    options: { containerId?: string | null | undefined } = {},
  ): DocumentsWorkflowRuntime {
    const containerId = Object.hasOwn(options, "containerId")
      ? options.containerId
      : this.client.session.containerId;
    const input = this.client.createWorkflowRuntimeInput(containerId);
    return createDocumentsWorkflowRuntime(input);
  }

  explorer(): ExplorerWorkflowRuntime {
    const input = this.client.createWorkflowRuntimeInput();
    return createExplorerWorkflowRuntime(input);
  }
}

export class Tearleads {
  readonly api: ApiClient;
  readonly blobs: TearleadsBlobs;
  readonly db: TearleadsDatabase;
  readonly events: TearleadsEvents;
  readonly identity: TearleadsIdentity;
  readonly network: TearleadsNetwork;
  readonly session: TearleadsSession;
  readonly workflows: TearleadsWorkflows;

  private readonly documentProjectors: DocumentProjectorRegistry;
  private domainScopeKey: string | null = null;
  private domainScopeValue = {};
  private readonly logErrorHandler: (
    message: string | Error,
    cause?: unknown,
  ) => void;
  private readonly logHandler: (message: string) => void;

  constructor(options: TearleadsOptions = {}) {
    this.api = options.apiClient ?? new ApiClient(options.apiBaseUrl ?? "");
    this.blobs = new TearleadsBlobs(options.blobStore);
    this.db = new TearleadsDatabase(normalizeDatabaseOptions(options.database));
    this.documentProjectors =
      options.documentProjectors ?? defaultDocumentProjectorRegistry;
    this.events = new TearleadsEvents(options.events);
    this.logHandler = options.logger?.log ?? (() => undefined);
    this.logErrorHandler = options.logger?.logError ?? logErrorToConsole;
    this.network = new TearleadsNetwork(options.online);
    this.identity = new TearleadsIdentity(
      options.identity,
      (signingFingerprint) =>
        this.blobs.updateIdentityNamespace(signingFingerprint),
      this.log,
    );
    this.session = new TearleadsSession(this);
    this.workflows = new TearleadsWorkflows(this);

    this.api.setOnError((message) => this.logError(message));
    this.api.setOnNetworkError(() => this.network.setOnline(false));
    this.api.setOnNetworkSuccess(() => this.network.setOnline(true));
  }

  log = (message: string): void => {
    this.logHandler(message);
  };

  logError = (message: string | Error, cause?: unknown): void => {
    this.logErrorHandler(message, cause);
  };

  get domainScope(): object {
    const nextScopeKey = `${this.db.id ?? ""}:${this.identity.signingFingerprint ?? ""}`;
    if (this.domainScopeKey !== nextScopeKey) {
      this.domainScopeKey = nextScopeKey;
      this.domainScopeValue = {};
    }

    return this.domainScopeValue;
  }

  createWorkflowRuntimeInput(containerId?: string | null | undefined) {
    const dbStatus = this.db.status;
    const execSql =
      dbStatus === "ready"
        ? this.db.requireExecSql("createWorkflowRuntimeInput")
        : unavailableExecSql;

    return {
      apiClient: this.api,
      blobStore: this.blobs.store,
      cacheReferencedPrincipalPolicies: (
        references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
      ) => this.cacheReferencedPrincipalPolicies(execSql, references),
      containerId: containerId ?? null,
      dbStatus,
      documentProjectors: this.documentProjectors,
      domainScope: this.domainScope,
      encapsulationKeyPair: this.identity.encapsulationKeyPair,
      events: this.events.events,
      // Runtime consumers branch on dbStatus before touching SQLite. The
      // fallback preserves the runtime shape and catches lifecycle bugs.
      execSql,
      isAuthenticated: this.session.isAuthenticated,
      log: this.log,
      logError: this.logError,
      online: this.network.online,
      organizationId: this.session.organizationId,
      signingFingerprint: this.identity.signingFingerprint,
      signingKeyPair: this.identity.signingKeyPair,
      userId: this.session.userId,
    };
  }

  private cacheReferencedPrincipalPolicies = async (
    execSql: ExecSql,
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ): Promise<void> => {
    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: (principalType, principalId) =>
        this.api.getCurrentPrincipalPolicy(principalType, principalId),
      getEncapsulationKey: (userId) => this.api.getEncapsulationKey(userId),
      log: this.log,
      references,
    });
  };
}
