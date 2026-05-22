import { ApiClient } from "@tearleads/api-client";
import type { BlobStore } from "../data/blobContracts";
import {
  type DocumentProjectorRegistry,
  defaultDocumentProjectorRegistry,
} from "../data/documents/documentKinds";
import { createDomainScope, type DomainScope } from "../data/domainScope";
import { TearleadsBlobs } from "./blobs";
import { createTearleadsContacts, type TearleadsContacts } from "./contacts";
import {
  createTearleadsContainerContents,
  type TearleadsContainerContents,
} from "./containerContents";
import { TearleadsDatabase, type TearleadsDatabaseOptions } from "./database";
import { createTearleadsDocuments, type TearleadsDocuments } from "./documents";
import { TearleadsEvents } from "./events";
import {
  createTearleadsIdentity,
  type TearleadsIdentity,
  type TearleadsIdentityOptions,
} from "./identity";
import { logErrorToConsole, type TearleadsLogger } from "./logger";
import { TearleadsNetwork } from "./network";
import { createTearleadsSession, type TearleadsSession } from "./session";
import {
  createTearleadsRuntime,
  type TearleadsRuntime,
} from "./workflowRuntime";

export interface TearleadsOptions {
  apiBaseUrl?: string | undefined;
  apiClient?: ApiClient | undefined;
  blobStore?: BlobStore | undefined;
  database?: TearleadsDatabaseOptions | undefined;
  documentProjectors?: DocumentProjectorRegistry | undefined;
  events?: ReadonlyArray<unknown> | undefined;
  identity?: TearleadsIdentityOptions | undefined;
  logger?: TearleadsLogger | undefined;
  online?: boolean | undefined;
}

export class Tearleads {
  readonly api: ApiClient;
  readonly blobs: TearleadsBlobs;
  readonly contacts: TearleadsContacts;
  readonly database: TearleadsDatabase;
  readonly documents: TearleadsDocuments;
  readonly events: TearleadsEvents;
  readonly containerContents: TearleadsContainerContents;
  readonly identity: TearleadsIdentity;
  readonly network: TearleadsNetwork;
  readonly runtime: TearleadsRuntime;
  readonly session: TearleadsSession;

  private readonly documentProjectors: DocumentProjectorRegistry;
  private domainScopeKey: string | null = null;
  private domainScopeValue: DomainScope = createDomainScope();
  private readonly logErrorHandler: (
    message: string | Error,
    cause?: unknown,
  ) => void;
  private readonly logHandler: (message: string) => void;

  constructor(options: TearleadsOptions = {}) {
    this.api = options.apiClient ?? new ApiClient(options.apiBaseUrl ?? "");
    this.blobs = new TearleadsBlobs(options.blobStore);
    this.database = new TearleadsDatabase(options.database);
    this.documentProjectors =
      options.documentProjectors ?? defaultDocumentProjectorRegistry;
    this.events = new TearleadsEvents(options.events);
    this.logHandler = options.logger?.log ?? (() => undefined);
    this.logErrorHandler = options.logger?.logError ?? logErrorToConsole;
    this.network = new TearleadsNetwork(options.online);
    this.identity = createTearleadsIdentity(
      options.identity,
      (signingFingerprint) =>
        this.blobs.updateIdentityNamespace(signingFingerprint),
      this.log,
    );
    this.session = createTearleadsSession({
      api: this.api,
      database: this.database,
      identity: this.identity,
      log: this.log,
    });
    this.runtime = createTearleadsRuntime({
      api: this.api,
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
    this.contacts = createTearleadsContacts(this.runtime);
    this.documents = createTearleadsDocuments({
      getDefaultContainerId: () => this.session.containerId,
      runtime: this.runtime,
    });
    this.containerContents = createTearleadsContainerContents(this.runtime);

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

  get domainScope(): DomainScope {
    const nextScopeKey = `${this.database.id ?? ""}:${this.identity.signingFingerprint ?? ""}`;
    if (this.domainScopeKey !== nextScopeKey) {
      this.domainScopeKey = nextScopeKey;
      this.domainScopeValue = createDomainScope();
    }

    return this.domainScopeValue;
  }
}
