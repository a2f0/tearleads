import { ApiClient } from "@tearleads/api-client";
import type { BlobStore } from "../data/blobContracts";
import {
  type DocumentProjectorRegistry,
  defaultDocumentProjectorRegistry,
} from "../data/documents/documentKinds";
import { TearleadsBlobs } from "./blobs";
import { TearleadsContacts } from "./contacts";
import { TearleadsDatabase, type TearleadsDatabaseOptions } from "./database";
import { TearleadsDocuments } from "./documents";
import { TearleadsEvents } from "./events";
import { TearleadsExplorer } from "./explorer";
import { TearleadsIdentity, type TearleadsIdentityOptions } from "./identity";
import { logErrorToConsole, type TearleadsLogger } from "./logger";
import { TearleadsNetwork } from "./network";
import { TearleadsSession } from "./session";
import {
  createTearleadsWorkflowRuntimeInput,
  type TearleadsWorkflowRuntimeInput,
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
  readonly explorer: TearleadsExplorer;
  readonly identity: TearleadsIdentity;
  readonly network: TearleadsNetwork;
  readonly session: TearleadsSession;

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
    this.database = new TearleadsDatabase(options.database);
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
    this.session = new TearleadsSession({
      api: this.api,
      database: this.database,
      identity: this.identity,
      log: this.log,
    });
    this.contacts = new TearleadsContacts({
      createWorkflowRuntimeInput: () => this.createWorkflowRuntimeInput(),
    });
    this.documents = new TearleadsDocuments({
      createWorkflowRuntimeInput: (containerId) =>
        this.createWorkflowRuntimeInput(containerId),
      getDefaultContainerId: () => this.session.containerId,
    });
    this.explorer = new TearleadsExplorer({
      createWorkflowRuntimeInput: () => this.createWorkflowRuntimeInput(),
    });

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
    const nextScopeKey = `${this.database.id ?? ""}:${this.identity.signingFingerprint ?? ""}`;
    if (this.domainScopeKey !== nextScopeKey) {
      this.domainScopeKey = nextScopeKey;
      this.domainScopeValue = {};
    }

    return this.domainScopeValue;
  }

  createWorkflowRuntimeInput(
    containerId?: string | null | undefined,
  ): TearleadsWorkflowRuntimeInput {
    return createTearleadsWorkflowRuntimeInput(
      {
        api: this.api,
        blobs: this.blobs,
        database: this.database,
        documentProjectors: this.documentProjectors,
        domainScope: this.domainScope,
        events: this.events,
        identity: this.identity,
        log: this.log,
        logError: this.logError,
        network: this.network,
        session: this.session,
      },
      containerId,
    );
  }
}
