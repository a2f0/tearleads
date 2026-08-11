import { ApiClient } from "@tearleads/api-client";
import type { BlobStore } from "../data/blobContracts";
import {
  type DocumentProjectorRegistry,
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../data/documents/documentKinds";
import { createDomainScope, type DomainScope } from "../data/domainScope";
import type { SecurityIncidentReporter } from "../data/securityIncidents";
import { disposeDomainSyncCoordinator } from "../data/sync/syncCoordinator";
import { resolveIdentityTrustDomain } from "../data/trustedUserIdentity";
import type { ProvisionedSystemContainerSpec } from "../workflows/registration";
import { type BlobStoreFactory, Blobs } from "./blobs";
import {
  type ContainerContents,
  createContainerContents,
} from "./containerContents";
import { Database, type DatabaseOptions } from "./database";
import { createDeviceFirst, type DeviceFirst } from "./deviceFirst";
import { createDocuments, type Documents } from "./documents";
import { Events } from "./events";
import {
  createIdentity,
  type Identity,
  type IdentityOptions,
} from "./identity";
import { type Logger, logErrorToConsole } from "./logger";
import { Network } from "./network";
import { createOrganizations, type Organizations } from "./organizations";
import {
  createSecurityIncidentService,
  type SecurityIncidentListener,
  type SecurityIncidents,
} from "./securityIncidents";
import { createSession } from "./session";
import type { Session } from "./session/sessionTypes";
import { SyncBillingGate } from "./syncBillingGate";
import { createUserIdentities, type UserIdentities } from "./userIdentities";
import {
  createRuntime,
  type InternalRuntime,
  type Runtime,
} from "./workflowRuntime";

function createClientSecurityIncidentService(input: {
  readonly apiBaseUrl: string;
  readonly database: Database;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly options: ClientOptions;
}) {
  const identityTrustDomain = resolveIdentityTrustDomain({
    apiBaseUrl: input.apiBaseUrl,
    identityTrustDomain: input.options.identityTrustDomain,
  });
  return {
    identityTrustDomain,
    service: createSecurityIncidentService({
      database: input.database,
      logError: input.logError,
      onIncident: input.options.onSecurityIncident,
      trustDomain: identityTrustDomain,
    }),
  };
}

export type ClientDatabaseOptions = Omit<DatabaseOptions, "status">;

export interface ClientOptions {
  apiBaseUrl?: string | undefined;
  blobStore?: BlobStore | undefined;
  blobStoreFactory?: BlobStoreFactory | undefined;
  database?: ClientDatabaseOptions | undefined;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  events?: ReadonlyArray<unknown> | undefined;
  identity?: IdentityOptions | undefined;
  /**
   * Absolute, host-controlled API namespace for durable user-identity pins.
   * Required only when apiBaseUrl is relative and no browser origin exists.
   */
  identityTrustDomain?: string | undefined;
  identityProvisioning?: "auto" | "manual" | undefined;
  logger?: Logger | undefined;
  online?: boolean | undefined;
  /** Called after a trust-boundary verification failure is durably recorded. */
  onSecurityIncident?: SecurityIncidentListener | undefined;
  /**
   * Per-pane discriminator so documents in distinct panes derive distinct Loro
   * peer ids (e.g. the pane's local identity namespace). Omit for single-pane.
   */
  peerScope?: string | undefined;
  /**
   * App-owned system containers born with every new organization (both
   * registration and additional-org creation provision them atomically in the
   * same server call), e.g. a trash bin. The app owns these because their slot
   * namespaces are app concepts the SDK stays agnostic to.
   */
  provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
}

export class Tearleads {
  readonly blobs: Blobs;
  readonly database: Database;
  readonly deviceFirst: DeviceFirst;
  readonly documents: Documents;
  readonly events: Events;
  readonly containerContents: ContainerContents;
  readonly identity: Identity;
  readonly network: Network;
  readonly organizations: Organizations;
  readonly runtime: Runtime;
  readonly securityIncidents: SecurityIncidents;
  readonly session: Session;
  readonly syncBillingGate: SyncBillingGate;
  readonly userIdentities: UserIdentities;

  private readonly apiClient: ApiClient;
  private readonly documentProjectors: DocumentProjectorRegistry;
  // Tracks the storage/identity pair that owns domain-scoped runtime state.
  private domainScopeKey: string | null = null;
  // Recreated when the storage database or signing identity changes.
  private domainScopeValue: DomainScope = createDomainScope();
  private readonly logErrorHandler: (
    message: string | Error,
    cause?: unknown,
  ) => void;
  private readonly logHandler: (message: string) => void;
  private autoIdentityProvisioned = false;
  private autoIdentityProvisioningPromise: Promise<void> | null = null;
  private expiredSessionLoginPromise: Promise<boolean> | null = null;

  constructor(options: ClientOptions = {}) {
    const apiBaseUrl = options.apiBaseUrl ?? "";
    this.apiClient = new ApiClient(apiBaseUrl);
    this.blobs = new Blobs(options.blobStore, options.blobStoreFactory);
    this.database = new Database(options.database);
    this.documentProjectors = resolveDocumentProjectorRegistry(
      options.documentProjectors,
    );
    this.events = new Events(options.events, () =>
      this.apiClient.clearWriterProjectionCaches(),
    );
    this.logHandler = options.logger?.log ?? (() => undefined);
    this.logErrorHandler = options.logger?.logError ?? logErrorToConsole;
    const security = createClientSecurityIncidentService({
      apiBaseUrl,
      database: this.database,
      logError: this.logError,
      options,
    });
    this.securityIncidents = security.service.incidents;
    this.network = new Network(options.online);
    this.syncBillingGate = new SyncBillingGate();
    let session: Session | null = null;
    this.identity = createIdentity(
      options.identity,
      (signingFingerprint) =>
        this.blobs.updateIdentityNamespace(signingFingerprint),
      this.log,
      {
        bootstrapLocalRootContainer: async () => {
          if (this.database.status !== "ready") {
            throw new Error(
              "identity.generate requires a ready SQLite database.",
            );
          }
          if (!session) {
            throw new Error(
              "identity.generate requires an initialized session.",
            );
          }

          return session.bootstrapLocalRootContainer();
        },
        getUserId: () => session?.userId ?? null,
      },
    );
    let pinLocalUserIdentity: InternalRuntime["pinLocalUserIdentity"] =
      async () => {
        throw new Error("Trusted user identity runtime is not initialized");
      };
    session = createSession({
      api: this.apiClient,
      database: this.database,
      documentProjectors: this.documentProjectors,
      identity: this.identity,
      log: this.log,
      logError: this.logError,
      onUserIdentityAvailable: (userId, candidate) =>
        pinLocalUserIdentity(userId, candidate),
      provisionedSystemContainers: options.provisionedSystemContainers,
    });
    this.session = session;
    const runtime = this.createWorkflowRuntime(
      security.identityTrustDomain,
      options,
      security.service.report,
    );
    pinLocalUserIdentity = async (userId, candidate) => {
      await runtime.pinLocalUserIdentity(userId, candidate);
    };
    this.runtime = runtime.publicRuntime;
    this.documents = createDocuments({
      getDefaultContainerId: () => this.session.containerId,
      runtime,
    });
    this.containerContents = createContainerContents(runtime);
    this.deviceFirst = createDeviceFirst(runtime, this.containerContents);
    this.organizations = createOrganizations(runtime, this.containerContents);
    this.userIdentities = createUserIdentities({
      log: this.log,
      resolveTrustedUserIdentity: (userId) =>
        runtime.workflowInput().resolveTrustedUserIdentity(userId),
    });

    this.configureApiClientCallbacks();

    if (options.identityProvisioning === "auto") {
      this.startAutomaticIdentityProvisioning();
    }
  }

  private configureApiClientCallbacks(): void {
    this.apiClient.setOnError((message) => this.logError(message));
    // An authoritative OS source owns connectivity. Without one, request
    // outcomes continue to drive the browser's reachability state.
    this.apiClient.setOnNetworkError(() =>
      this.network.reportReachability(false),
    );
    this.apiClient.setOnNetworkSuccess(() =>
      this.network.reportReachability(true),
    );
    this.apiClient.setOnSessionExpired(() => this.loginAfterSessionExpired());
    this.apiClient.setOnPaymentRequired((organizationId) =>
      this.syncBillingGate.notifyPaymentRequired(organizationId),
    );
  }

  private createWorkflowRuntime(
    identityTrustDomain: string | null,
    options: ClientOptions,
    reportSecurityIncident: SecurityIncidentReporter,
  ): InternalRuntime {
    return createRuntime({
      api: this.apiClient,
      blobs: this.blobs,
      database: this.database,
      documentProjectors: this.documentProjectors,
      events: this.events,
      getDomainScope: () => this.domainScope,
      identity: this.identity,
      identityTrustDomain,
      log: this.log,
      logError: this.logError,
      network: this.network,
      peerScope: options.peerScope ?? null,
      reportSecurityIncident,
      session: this.session,
      syncBillingGate: this.syncBillingGate,
    });
  }

  log = (message: string): void => {
    this.logHandler(message);
  };

  logError = (message: string | Error, cause?: unknown): void => {
    this.logErrorHandler(message, cause);
  };

  /**
   * Mint a single-use ticket to authenticate the server-events websocket
   * handshake (which cannot carry the bearer header). Returns null when no
   * session is active. The caller appends it to the websocket URL.
   */
  requestWebSocketTicket(): Promise<string | null> {
    return this.apiClient.requestWebSocketTicket();
  }

  get domainScope(): DomainScope {
    const nextScopeKey = JSON.stringify([
      this.database.id,
      this.identity.signingFingerprint,
    ]);
    if (this.domainScopeKey !== nextScopeKey) {
      this.domainScopeKey = nextScopeKey;
      this.domainScopeValue = createDomainScope();
    }

    return this.domainScopeValue;
  }

  /**
   * Tear down background work for the active domain scope: stop the reconciler
   * and force-stop the sync coordinator pump, then drop the coordinator from
   * its registry. Hosts call this from unmount/cleanup so a pump cannot outlive
   * the React tree that created it. A later access for the same scope rebuilds
   * fresh state.
   */
  dispose(): void {
    const domainScope = this.domainScope;
    this.deviceFirst.dispose();
    disposeDomainSyncCoordinator(domainScope);
  }

  private loginAfterSessionExpired(): Promise<boolean> {
    if (!this.session.authToken || !this.identity.signingKeyPair) {
      this.session.logout();
      return Promise.resolve(false);
    }

    this.expiredSessionLoginPromise ??= this.session.login().finally(() => {
      this.expiredSessionLoginPromise = null;
    });
    return this.expiredSessionLoginPromise;
  }

  private startAutomaticIdentityProvisioning(): void {
    let unsubscribe: (() => void) | null = null;
    const stopProvisioningListener = () => {
      unsubscribe?.();
      unsubscribe = null;
    };
    const maybeProvisionIdentity = () => {
      if (this.autoIdentityProvisioned || this.identity.signingKeyPair) {
        stopProvisioningListener();
        return;
      }

      if (
        this.autoIdentityProvisioningPromise ||
        this.database.status !== "ready"
      ) {
        return;
      }

      this.autoIdentityProvisioningPromise = this.identity
        .generate()
        .then(() => {
          this.autoIdentityProvisioned = true;
          stopProvisioningListener();
        })
        .catch((error: unknown) => {
          try {
            this.logError("Automatic identity provisioning failed", error);
          } catch {
            // Keep background provisioning failures from surfacing as unhandled rejections.
          }
        })
        .finally(() => {
          this.autoIdentityProvisioningPromise = null;
        });
    };

    unsubscribe = this.database.subscribe(maybeProvisionIdentity);
    void Promise.resolve().then(maybeProvisionIdentity);
  }
}
