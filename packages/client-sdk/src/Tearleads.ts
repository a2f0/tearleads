import {
  ApiClient,
  ApiRequestMetrics,
  createApiReachabilityProbe,
  openServerEventsSocket,
} from "@tearleads/api-client";
import { Blobs } from "./client/blobs";
import {
  type ContainerContents,
  createContainerContents,
} from "./client/containerContents";
import { createDeviceFirst, type DeviceFirst } from "./client/deviceFirst";
import { createDocuments, type Documents } from "./client/documents";
import { logErrorToConsole } from "./client/host/logger";
import { createIdentity, type Identity } from "./client/identity";
import {
  createUserIdentities,
  type UserIdentities,
} from "./client/identity/userIdentities";
import {
  createOrganizations,
  type Organizations,
} from "./client/organizations";
import { createRoot, type Root, rootRuntimeOf } from "./client/root";
import { ApiVersion } from "./client/runtime/apiVersion";
import { Database } from "./client/runtime/database";
import { Events } from "./client/runtime/events";
import { Network } from "./client/runtime/network";
import { SyncBillingGate } from "./client/runtime/syncBillingGate";
import {
  createRuntime,
  type InternalRuntime,
  type Runtime,
} from "./client/runtime/workflowRuntime";
import {
  createSecurityIncidentService,
  type SecurityIncidents,
} from "./client/securityIncidents";
import { createSession } from "./client/session";
import type { Session } from "./client/session/sessionTypes";
import {
  type DocumentProjectorRegistry,
  resolveDocumentProjectorRegistry,
} from "./data/documents/documentKinds";
import { createVerifiedManifestCitations } from "./data/persistence/verifiedManifestBundlePersistence";
import { createDomainScope, type DomainScope } from "./data/shared/domainScope";
import type { SecurityIncidentReporter } from "./data/shared/securityIncidents";
import { disposeDomainSyncCoordinator } from "./data/sync/syncCoordinator";
import { resolveIdentityTrustDomain } from "./data/trustedUserIdentity";
import type { TearleadsOptions } from "./TearleadsOptions";

export class Tearleads {
  readonly apiVersion = new ApiVersion();
  readonly apiRequests: ApiRequestMetrics;
  readonly blobs: Blobs;
  readonly database: Database;
  readonly deviceFirst: DeviceFirst;
  readonly documents: Documents;
  readonly events: Events;
  readonly containerContents: ContainerContents;
  readonly identity: Identity;
  readonly network: Network;
  readonly organizations: Organizations;
  readonly root: Root;
  readonly runtime: Runtime;
  readonly securityIncidents: SecurityIncidents;
  readonly session: Session;
  readonly syncBillingGate: SyncBillingGate;
  readonly userIdentities: UserIdentities;

  private readonly apiClient: ApiClient;
  private readonly documentProjectors: DocumentProjectorRegistry;
  private readonly disposeSecurityIncidents: () => void;
  private retirePrincipalHistoryProtection = () => {};
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
  // Rebound to the workflow runtime once it exists; the session is created first.
  private pinLocalUserIdentity: InternalRuntime["pinLocalUserIdentity"] =
    async () => {
      throw new Error("Trusted user identity runtime is not initialized");
    };
  private primeProvisionedPrincipalHistory: InternalRuntime["primeProvisionedPrincipalHistory"] =
    async () => undefined;
  private boundUserId: InternalRuntime["boundUserId"] = async () => {
    throw new Error("Trusted user identity runtime is not initialized");
  };

  constructor(options: TearleadsOptions = {}) {
    const apiBaseUrl = options.apiBaseUrl ?? "";
    this.apiRequests = options.apiRequestMetrics ?? new ApiRequestMetrics();
    this.apiClient = this.createApiClient(
      apiBaseUrl,
      options.probeApiNetworkFailures === true,
    );
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
    const identityTrustDomain = resolveIdentityTrustDomain({
      apiBaseUrl,
      identityTrustDomain: options.identityTrustDomain,
    });
    const security = this.createSecurityIncidents(identityTrustDomain, options);
    this.securityIncidents = security.incidents;
    this.disposeSecurityIncidents = security.dispose;
    this.network = new Network(options.online);
    this.syncBillingGate = new SyncBillingGate();
    let session: Session | null = null;
    this.identity = createIdentity(options.identity, this.blobs, this.log, {
      assertReadyForGeneration: () => {
        if (this.database.status !== "ready") {
          throw new Error(
            "identity.generate requires a ready SQLite database.",
          );
        }
      },
      bootstrapLocalRootContainer: async (isCurrent) => {
        if (!session) {
          throw new Error("identity.generate requires an initialized session.");
        }

        return session.bootstrapLocalRootContainer(isCurrent);
      },
      getUserId: () => session?.userId ?? null,
    });
    session = this.createClientSession(options, security.report);
    this.session = session;
    const runtime = this.createWorkflowRuntime(
      identityTrustDomain,
      options,
      security.report,
    );
    this.bindTrustedIdentityRuntime(runtime);
    this.runtime = runtime.publicRuntime;
    this.documents = createDocuments({
      getDefaultContainerId: () => this.session.containerId,
      runtime,
    });
    this.containerContents = createContainerContents(runtime);
    this.deviceFirst = createDeviceFirst(runtime, this.containerContents);
    this.organizations = createOrganizations(
      runtime,
      this.containerContents,
      () => this.deviceFirst.open().reconciler,
    );
    this.root = createRoot(rootRuntimeOf(runtime, this.session));
    this.userIdentities = createUserIdentities({
      getOrganizationId: () => this.session.organizationId,
      reportSecurityIncident: security.report,
      identityLinks: runtime.identityLinks,
    });

    this.configureApiClientCallbacks();

    if (options.identityProvisioning === "auto") {
      this.startAutomaticIdentityProvisioning();
    }
  }

  /** Durable incident records in this database, reported to the host's listener. */
  private createSecurityIncidents(
    trustDomain: string | null,
    options: TearleadsOptions,
  ) {
    return createSecurityIncidentService({
      database: this.database,
      logError: this.logError,
      onIncident: options.onSecurityIncident,
      trustDomain,
    });
  }

  /** Trust callbacks reach the workflow runtime, which is created later. */
  private createClientSession(
    options: TearleadsOptions,
    reportSecurityIncident: SecurityIncidentReporter,
  ): Session {
    return createSession({
      api: this.apiClient,
      database: this.database,
      documentProjectors: this.documentProjectors,
      identity: this.identity,
      log: this.log,
      logError: this.logError,
      boundUserIdForSigningKey: (signingKeyFingerprint) =>
        this.boundUserId(signingKeyFingerprint),
      onUserIdentityAvailable: (userId, candidate) =>
        this.pinLocalUserIdentity(userId, candidate),
      primeProvisionedPrincipalHistory: (input) =>
        this.primeProvisionedPrincipalHistory(input),
      provisionedSystemContainers: options.provisionedSystemContainers,
      reportSecurityIncident,
    });
  }

  private createApiClient(
    apiBaseUrl: string,
    probeNetworkFailures: boolean,
  ): ApiClient {
    return new ApiClient(apiBaseUrl, {
      metrics: this.apiRequests,
      getIdentity: () => this.identity.signingFingerprint,
      // A native source beats a WebView's navigator.onLine (Android misreports it).
      isOnline: () => this.network.authoritativeOnline,
      networkFailureProbe: probeNetworkFailures
        ? createApiReachabilityProbe()
        : null,
    });
  }

  /** Rebinds the session's trust callbacks once the runtime exists. */
  private bindTrustedIdentityRuntime(runtime: InternalRuntime): void {
    this.retirePrincipalHistoryProtection =
      runtime.retirePrincipalHistoryProtection;
    this.pinLocalUserIdentity = (userId, candidate) =>
      runtime.pinLocalUserIdentity(userId, candidate);
    this.primeProvisionedPrincipalHistory =
      runtime.primeProvisionedPrincipalHistory;
    this.boundUserId = (signingKeyFingerprint) =>
      runtime.boundUserId(signingKeyFingerprint);
  }

  private configureApiClientCallbacks(): void {
    // Projection reads cite bundles this identity's database already verified.
    this.apiClient.setVerifiedManifestCitations(
      createVerifiedManifestCitations(() => this.database.execSql),
    );
    this.apiClient.setOnError((message) => this.logError(message));
    // An authoritative host source owns connectivity. Without one, request
    // outcomes remain reachability hints. Browser and native app bindings both
    // install authoritative sources so a backend outage cannot stop retries.
    this.apiClient.setOnNetworkError(() =>
      this.network.reportReachability(false),
    );
    this.apiClient.setOnNetworkSuccess(() =>
      this.network.reportReachability(true),
    );
    this.apiClient.setOnApiVersion((version) =>
      this.apiVersion.observe(version),
    );
    this.apiClient.setOnSessionExpired(() => this.loginAfterSessionExpired());
    this.apiClient.setOnPaymentRequired((organizationId) =>
      this.syncBillingGate.notifyPaymentRequired(organizationId),
    );
  }

  private createWorkflowRuntime(
    identityTrustDomain: string | null,
    options: TearleadsOptions,
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
      principalHistoryKeyProvider: options.principalHistoryKeyProvider,
      principalMutationTimeoutMs: options.principalMutationTimeoutMs,
      reportSecurityIncident,
      session: this.session,
      syncBillingGate: this.syncBillingGate,
    });
  }

  log = (message: string): void => {
    this.logHandler(message);
  };

  // Preserve the host's return value so best-effort callers can also catch
  // rejected promises from async loggers accepted by the void callback type.
  logError = (message: string | Error, cause?: unknown): void =>
    this.logErrorHandler(message, cause);

  /**
   * A single-use ticket to authenticate the server-events websocket handshake
   * (which cannot carry the bearer header): the one login returned for the
   * first connect of that session, otherwise a freshly minted one. Returns
   * null when no session is active. Pass it to {@link openServerEventsSocket}.
   */
  requestWebSocketTicket(): Promise<string | null> {
    return this.apiClient.requestWebSocketTicket();
  }

  /** Opens the API's server-events socket for a ticket; the API client owns the URL shape. */
  openServerEventsSocket(wsUrl: string, ticket: string): WebSocket {
    return openServerEventsSocket(wsUrl, ticket);
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
    this.disposeSecurityIncidents();
    this.retirePrincipalHistoryProtection();
    this.deviceFirst.dispose();
    disposeDomainSyncCoordinator(domainScope);
  }

  private loginAfterSessionExpired(): Promise<boolean> {
    if (!this.session.authToken || !this.identity.signingKeyPair) {
      this.session.logout();
      return Promise.resolve(false);
    }

    // The API client replays requests the expired session sent, so a login is
    // their renewal only when the loaded keys authenticate that known user.
    const expiredUserId = this.session.userId;
    this.expiredSessionLoginPromise ??= this.session
      .login()
      .then(
        (renewed) =>
          renewed &&
          expiredUserId !== null &&
          this.session.userId === expiredUserId,
      )
      .finally(() => {
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
