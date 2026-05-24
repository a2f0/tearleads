import type { ApiClient } from "@tearleads/api-client";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../data/blobContracts";
import type { DocumentProjectorRegistry } from "../data/documents/documentKinds";
import type { DomainScope } from "../data/domainScope";
import { type ExecSql, unavailableExecSql } from "../data/sqlite/sqlSchema";
import { cacheReferencedPrincipalPolicies } from "../workflows/principals";
import type { TearleadsBlobs } from "./blobs";
import type { TearleadsDatabase, TearleadsDatabaseStatus } from "./database";
import type { TearleadsEvents } from "./events";
import type { TearleadsIdentity } from "./identity";
import type { TearleadsNetwork } from "./network";
import type { TearleadsSession } from "./session";

export interface TearleadsWorkflowRuntimeInput {
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly containerId: string | null;
  readonly dbStatus: TearleadsDatabaseStatus;
  readonly documentProjectors: DocumentProjectorRegistry;
  readonly domainScope: DomainScope;
  readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  readonly events: ReadonlyArray<unknown>;
  readonly execSql: ExecSql;
  readonly isAuthenticated: boolean;
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly online: boolean;
  readonly organizationId: string | null;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: SigningKeyPair | null;
  readonly userId: string | null;
}

export type TearleadsRuntimeListener = () => void;

export interface TearleadsRuntime {
  readonly version: number;
  input(containerId?: string | null | undefined): TearleadsWorkflowRuntimeInput;
  subscribe(listener: TearleadsRuntimeListener): () => void;
}

export interface TearleadsInternalWorkflowRuntimeInput
  extends TearleadsWorkflowRuntimeInput {
  readonly apiClient: ApiClient;
}

export interface TearleadsInternalRuntime {
  readonly publicRuntime: TearleadsRuntime;
  workflowInput(
    containerId?: string | null | undefined,
  ): TearleadsInternalWorkflowRuntimeInput;
}

interface TearleadsWorkflowRuntimeDependencies {
  api: ApiClient;
  blobs: TearleadsBlobs;
  database: TearleadsDatabase;
  documentProjectors: DocumentProjectorRegistry;
  events: TearleadsEvents;
  getDomainScope: () => DomainScope;
  identity: TearleadsIdentity;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  network: TearleadsNetwork;
  session: TearleadsSession;
}

export function createTearleadsRuntime(
  dependencies: TearleadsWorkflowRuntimeDependencies,
): TearleadsInternalRuntime {
  const runtimeSubscription = createTearleadsRuntimeSubscription(dependencies);

  return {
    publicRuntime: {
      get version() {
        return runtimeSubscription.version;
      },
      input: (containerId) =>
        createTearleadsHostRuntimeInput(dependencies, containerId),
      subscribe: runtimeSubscription.subscribe,
    },
    workflowInput: (containerId) =>
      createTearleadsWorkflowRuntimeInput(dependencies, containerId),
  };
}

function createTearleadsRuntimeSubscription(
  dependencies: TearleadsWorkflowRuntimeDependencies,
) {
  const listeners = new Set<TearleadsRuntimeListener>();
  let version = 0;
  const notifyListeners = () => {
    version += 1;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Keep one subscriber failure from blocking later subscribers.
      }
    }
  };

  dependencies.database.subscribe(notifyListeners);
  dependencies.events.subscribe(notifyListeners);
  dependencies.identity.subscribe(notifyListeners);
  dependencies.network.subscribe(() => notifyListeners());
  dependencies.session.subscribe(notifyListeners);

  return {
    get version() {
      return version;
    },
    subscribe(listener: TearleadsRuntimeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function createTearleadsHostRuntimeInput(
  dependencies: TearleadsWorkflowRuntimeDependencies,
  containerId?: string | null | undefined,
): TearleadsWorkflowRuntimeInput {
  const { apiClient: _apiClient, ...input } =
    createTearleadsWorkflowRuntimeInput(dependencies, containerId);
  return input;
}

function createTearleadsWorkflowRuntimeInput(
  dependencies: TearleadsWorkflowRuntimeDependencies,
  containerId?: string | null | undefined,
): TearleadsInternalWorkflowRuntimeInput {
  const dbStatus = dependencies.database.status;
  const execSql =
    dbStatus === "ready"
      ? dependencies.database.requireExecSql("tearleads.runtime.input")
      : unavailableExecSql;

  return {
    apiClient: dependencies.api,
    blobStore: dependencies.blobs.store,
    cacheReferencedPrincipalPolicies: (
      references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
    ) =>
      cacheReferencedPrincipalPolicies({
        execSql,
        getCurrentPrincipalPolicy: (principalType, principalId) =>
          dependencies.api.getCurrentPrincipalPolicy(
            principalType,
            principalId,
          ),
        getEncapsulationKey: (userId) =>
          dependencies.api.getEncapsulationKey(userId),
        log: dependencies.log,
        references,
      }),
    containerId:
      (containerId === undefined
        ? dependencies.session.containerId
        : containerId) ?? null,
    dbStatus,
    documentProjectors: dependencies.documentProjectors,
    domainScope: dependencies.getDomainScope(),
    encapsulationKeyPair: dependencies.identity.encapsulationKeyPair,
    events: dependencies.events.events,
    // Runtime consumers branch on dbStatus before touching SQLite. The
    // fallback preserves the runtime shape and catches lifecycle bugs.
    execSql,
    isAuthenticated: dependencies.session.isAuthenticated,
    log: dependencies.log,
    logError: dependencies.logError,
    online: dependencies.network.online,
    organizationId: dependencies.session.organizationId,
    signingFingerprint: dependencies.identity.signingFingerprint,
    signingKeyPair: dependencies.identity.signingKeyPair,
    userId: dependencies.session.userId,
  };
}
