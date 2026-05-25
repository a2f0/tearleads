import type { ApiClient } from "@tearleads/api-client";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../data/blobContracts";
import type { DocumentProjectorRegistry } from "../data/documents/documentKinds";
import type { DomainScope } from "../data/domainScope";
import { type ExecSql, unavailableExecSql } from "../data/sqlite/sqlSchema";
import { cacheReferencedPrincipalPolicies } from "../workflows/principals";
import type { Blobs } from "./blobs";
import type { Database, DatabaseStatus } from "./database";
import type { Events } from "./events";
import type { Identity } from "./identity";
import type { Network } from "./network";
import type { Session } from "./session";

export interface WorkflowRuntimeInput {
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly containerId: string | null;
  readonly dbStatus: DatabaseStatus;
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

export type RuntimeListener = () => void;

export interface Runtime {
  readonly version: number;
  input(containerId?: string | null | undefined): WorkflowRuntimeInput;
  subscribe(listener: RuntimeListener): () => void;
}

export interface InternalWorkflowRuntimeInput extends WorkflowRuntimeInput {
  readonly apiClient: ApiClient;
}

export interface InternalRuntime {
  readonly publicRuntime: Runtime;
  workflowInput(
    containerId?: string | null | undefined,
  ): InternalWorkflowRuntimeInput;
}

interface WorkflowRuntimeDependencies {
  api: ApiClient;
  blobs: Blobs;
  database: Database;
  documentProjectors: DocumentProjectorRegistry;
  events: Events;
  getDomainScope: () => DomainScope;
  identity: Identity;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  network: Network;
  session: Session;
}

export function createRuntime(
  dependencies: WorkflowRuntimeDependencies,
): InternalRuntime {
  const runtimeSubscription = createRuntimeSubscription(dependencies);

  return {
    publicRuntime: {
      get version() {
        return runtimeSubscription.version;
      },
      input: (containerId) => createHostRuntimeInput(dependencies, containerId),
      subscribe: runtimeSubscription.subscribe,
    },
    workflowInput: (containerId) =>
      createWorkflowRuntimeInput(dependencies, containerId),
  };
}

function createRuntimeSubscription(dependencies: WorkflowRuntimeDependencies) {
  const listeners = new Set<RuntimeListener>();
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
    subscribe(listener: RuntimeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function createHostRuntimeInput(
  dependencies: WorkflowRuntimeDependencies,
  containerId?: string | null | undefined,
): WorkflowRuntimeInput {
  const { apiClient: _apiClient, ...input } = createWorkflowRuntimeInput(
    dependencies,
    containerId,
  );
  return input;
}

function createWorkflowRuntimeInput(
  dependencies: WorkflowRuntimeDependencies,
  containerId?: string | null | undefined,
): InternalWorkflowRuntimeInput {
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
