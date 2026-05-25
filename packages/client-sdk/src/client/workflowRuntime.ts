import type { ApiClient } from "@tearleads/api-client";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { DocumentProjectorRegistry } from "../data/documents/documentKinds";
import type { DomainScope } from "../data/domainScope";
import { type ExecSql, unavailableExecSql } from "../data/sqlite/sqlSchema";
import { cacheReferencedPrincipalPolicies } from "../workflows/principals";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeGroups,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../workflows/runtimeInput";
import type { Blobs } from "./blobs";
import type { Database, DatabaseStatus } from "./database";
import type { Events } from "./events";
import type { Identity } from "./identity";
import type { Network } from "./network";
import type { Session } from "./session";

export type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeGroups,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../workflows/runtimeInput";

export interface WorkflowRuntimeInput extends WorkflowRuntimeGroups {
  readonly blobStore: WorkflowRuntimeInfraInput["blobStore"];
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly containerId: string | null;
  readonly dbStatus: DatabaseStatus;
  readonly documentProjectors: WorkflowRuntimeInfraInput["documentProjectors"];
  readonly domainScope: WorkflowRuntimeStateInput["domainScope"];
  readonly encapsulationKeyPair: WorkflowRuntimeCryptoInput["encapsulationKeyPair"];
  readonly events: ReadonlyArray<unknown>;
  readonly execSql: ExecSql;
  readonly isAuthenticated: boolean;
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly online: boolean;
  readonly organizationId: string | null;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: WorkflowRuntimeCryptoInput["signingKeyPair"];
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
  const publicRuntimeInput = createRuntimeInputFactory(dependencies);
  const internalRuntimeInput = createRuntimeInputFactory(dependencies);

  return {
    publicRuntime: {
      get version() {
        return runtimeSubscription.version;
      },
      input: publicRuntimeInput.hostInput,
      subscribe: runtimeSubscription.subscribe,
    },
    workflowInput: internalRuntimeInput.workflowInput,
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

interface RuntimeInputFactory {
  hostInput(containerId?: string | null | undefined): WorkflowRuntimeInput;
  workflowInput(
    containerId?: string | null | undefined,
  ): InternalWorkflowRuntimeInput;
}

function createRuntimeInputFactory(
  dependencies: WorkflowRuntimeDependencies,
): RuntimeInputFactory {
  let auth: WorkflowRuntimeAuthInput | undefined;
  let crypto: WorkflowRuntimeCryptoInput | undefined;
  let infra: WorkflowRuntimeInfraInput | undefined;
  let state: WorkflowRuntimeStateInput | undefined;
  let util: WorkflowRuntimeUtilInput | undefined;
  let utilExecSql: ExecSql | undefined;

  const workflowInput = (
    containerId?: string | null | undefined,
  ): InternalWorkflowRuntimeInput => {
    const dbStatus = dependencies.database.status;
    const execSql =
      dbStatus === "ready"
        ? dependencies.database.requireExecSql("tearleads.runtime.input")
        : unavailableExecSql;
    const nextContainerId =
      (containerId === undefined
        ? dependencies.session.containerId
        : containerId) ?? null;

    auth = reuseWorkflowRuntimeAuth(auth, {
      isAuthenticated: dependencies.session.isAuthenticated,
      organizationId: dependencies.session.organizationId,
      userId: dependencies.session.userId,
    });
    crypto = reuseWorkflowRuntimeCrypto(crypto, {
      encapsulationKeyPair: dependencies.identity.encapsulationKeyPair,
      signingFingerprint: dependencies.identity.signingFingerprint,
      signingKeyPair: dependencies.identity.signingKeyPair,
    });
    infra = reuseWorkflowRuntimeInfra(infra, {
      blobStore: dependencies.blobs.store,
      dbStatus,
      documentProjectors: dependencies.documentProjectors,
      // Runtime consumers branch on dbStatus before touching SQLite. The
      // fallback preserves the runtime shape and catches lifecycle bugs.
      execSql,
    });
    state = reuseWorkflowRuntimeState(state, {
      containerId: nextContainerId,
      domainScope: dependencies.getDomainScope(),
      events: dependencies.events.events,
      online: dependencies.network.online,
    });
    if (
      !util ||
      utilExecSql !== execSql ||
      util.log !== dependencies.log ||
      util.logError !== dependencies.logError
    ) {
      util = {
        cacheReferencedPrincipalPolicies:
          createCacheReferencedPrincipalPolicies(dependencies, execSql),
        log: dependencies.log,
        logError: dependencies.logError,
      };
      utilExecSql = execSql;
    }

    return createInternalWorkflowRuntimeInput(
      dependencies.api,
      auth,
      crypto,
      infra,
      state,
      util,
    );
  };

  return {
    hostInput(containerId) {
      const { apiClient: _apiClient, ...input } = workflowInput(containerId);
      return input;
    },
    workflowInput,
  };
}

function createInternalWorkflowRuntimeInput(
  apiClient: ApiClient,
  auth: WorkflowRuntimeAuthInput,
  crypto: WorkflowRuntimeCryptoInput,
  infra: WorkflowRuntimeInfraInput,
  state: WorkflowRuntimeStateInput,
  util: WorkflowRuntimeUtilInput,
): InternalWorkflowRuntimeInput {
  return {
    apiClient,
    auth,
    blobStore: infra.blobStore,
    cacheReferencedPrincipalPolicies: util.cacheReferencedPrincipalPolicies,
    containerId: state.containerId,
    crypto,
    dbStatus: infra.dbStatus,
    documentProjectors: infra.documentProjectors,
    domainScope: state.domainScope,
    encapsulationKeyPair: crypto.encapsulationKeyPair,
    events: state.events,
    execSql: infra.execSql,
    infra,
    isAuthenticated: auth.isAuthenticated,
    log: util.log,
    logError: util.logError,
    online: state.online,
    organizationId: auth.organizationId,
    signingFingerprint: crypto.signingFingerprint,
    signingKeyPair: crypto.signingKeyPair,
    state,
    userId: auth.userId,
    util,
  };
}

function createCacheReferencedPrincipalPolicies(
  dependencies: WorkflowRuntimeDependencies,
  execSql: ExecSql,
): WorkflowRuntimeUtilInput["cacheReferencedPrincipalPolicies"] {
  return (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) =>
    cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: (principalType, principalId) =>
        dependencies.api.getCurrentPrincipalPolicy(principalType, principalId),
      getEncapsulationKey: (userId) =>
        dependencies.api.getEncapsulationKey(userId),
      log: dependencies.log,
      references,
    });
}

function reuseWorkflowRuntimeAuth(
  current: WorkflowRuntimeAuthInput | undefined,
  next: WorkflowRuntimeAuthInput,
): WorkflowRuntimeAuthInput {
  return current &&
    current.isAuthenticated === next.isAuthenticated &&
    current.organizationId === next.organizationId &&
    current.userId === next.userId
    ? current
    : next;
}

function reuseWorkflowRuntimeCrypto(
  current: WorkflowRuntimeCryptoInput | undefined,
  next: WorkflowRuntimeCryptoInput,
): WorkflowRuntimeCryptoInput {
  return current &&
    current.encapsulationKeyPair === next.encapsulationKeyPair &&
    current.signingFingerprint === next.signingFingerprint &&
    current.signingKeyPair === next.signingKeyPair
    ? current
    : next;
}

function reuseWorkflowRuntimeInfra(
  current: WorkflowRuntimeInfraInput | undefined,
  next: WorkflowRuntimeInfraInput,
): WorkflowRuntimeInfraInput {
  return current &&
    current.blobStore === next.blobStore &&
    current.dbStatus === next.dbStatus &&
    current.documentProjectors === next.documentProjectors &&
    current.execSql === next.execSql
    ? current
    : next;
}

function reuseWorkflowRuntimeState(
  current: WorkflowRuntimeStateInput | undefined,
  next: WorkflowRuntimeStateInput,
): WorkflowRuntimeStateInput {
  return current &&
    current.containerId === next.containerId &&
    current.domainScope === next.domainScope &&
    current.events === next.events &&
    current.online === next.online
    ? current
    : next;
}
