import { ApiClient } from "@tearleads/api-client";
import type { BlobStore } from "../data/blobContracts";
import {
  type DocumentProjectorRegistry,
  defaultDocumentProjectorRegistry,
} from "../data/documents/documentKinds";
import { createDomainScope, type DomainScope } from "../data/domainScope";
import { Blobs } from "./blobs";
import {
  type ContainerContents,
  createContainerContents,
} from "./containerContents";
import { Database, type DatabaseOptions } from "./database";
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
import { createSession, type Session } from "./session";
import { createUserKeys, type UserKeys } from "./userKeys";
import { createRuntime, type Runtime } from "./workflowRuntime";

export interface ClientOptions {
  apiBaseUrl?: string | undefined;
  apiClient?: ApiClient | undefined;
  blobStore?: BlobStore | undefined;
  database?: DatabaseOptions | undefined;
  documentProjectors?: DocumentProjectorRegistry | undefined;
  events?: ReadonlyArray<unknown> | undefined;
  identity?: IdentityOptions | undefined;
  logger?: Logger | undefined;
  online?: boolean | undefined;
}

export class Tearleads {
  readonly blobs: Blobs;
  readonly database: Database;
  readonly documents: Documents;
  readonly events: Events;
  readonly containerContents: ContainerContents;
  readonly identity: Identity;
  readonly network: Network;
  readonly organizations: Organizations;
  readonly runtime: Runtime;
  readonly session: Session;
  readonly userKeys: UserKeys;

  private readonly apiClient: ApiClient;
  private readonly documentProjectors: DocumentProjectorRegistry;
  private domainScopeKey: string | null = null;
  private domainScopeValue: DomainScope = createDomainScope();
  private readonly logErrorHandler: (
    message: string | Error,
    cause?: unknown,
  ) => void;
  private readonly logHandler: (message: string) => void;

  constructor(options: ClientOptions = {}) {
    this.apiClient =
      options.apiClient ?? new ApiClient(options.apiBaseUrl ?? "");
    this.blobs = new Blobs(options.blobStore);
    this.database = new Database(options.database);
    this.documentProjectors =
      options.documentProjectors ?? defaultDocumentProjectorRegistry;
    this.events = new Events(options.events);
    this.logHandler = options.logger?.log ?? (() => undefined);
    this.logErrorHandler = options.logger?.logError ?? logErrorToConsole;
    this.network = new Network(options.online);
    this.identity = createIdentity(
      options.identity,
      (signingFingerprint) =>
        this.blobs.updateIdentityNamespace(signingFingerprint),
      this.log,
    );
    this.session = createSession({
      api: this.apiClient,
      database: this.database,
      identity: this.identity,
      log: this.log,
      logError: this.logError,
    });
    const runtime = createRuntime({
      api: this.apiClient,
      blobs: this.blobs,
      database: this.database,
      documentProjectors: this.documentProjectors,
      events: this.events,
      getDomainScope: () => this.domainScope,
      identity: this.identity,
      log: this.log,
      logError: this.logError,
      network: this.network,
      session: this.session,
    });
    this.runtime = runtime.publicRuntime;
    this.documents = createDocuments({
      getDefaultContainerId: () => this.session.containerId,
      runtime,
    });
    this.containerContents = createContainerContents(runtime);
    this.organizations = createOrganizations(runtime);
    this.userKeys = createUserKeys({
      apiClient: this.apiClient,
      log: this.log,
    });

    this.apiClient.setOnError((message) => this.logError(message));
    this.apiClient.setOnNetworkError(() => this.network.setOnline(false));
    this.apiClient.setOnNetworkSuccess(() => this.network.setOnline(true));
  }

  log = (message: string): void => {
    this.logHandler(message);
  };

  logError = (message: string | Error, cause?: unknown): void => {
    this.logErrorHandler(message, cause);
  };

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
}
