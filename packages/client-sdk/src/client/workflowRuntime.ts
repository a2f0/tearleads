import type { ApiClient } from "@tearleads/api-client";
import type { DocumentProjectorRegistry } from "../data/documents/documentKinds";
import type { DomainScope } from "../data/domainScope";
import { unavailableExecSql } from "../data/sqlite/sqlSchema";
import {
  createApiUserIdentitySource,
  createTrustedUserIdentityService,
  type LocalUserIdentityCandidate,
  type TrustedUserIdentityResolver,
} from "../data/trustedUserIdentity";
import type { ContainerContentsRootAdopter } from "../workflows/container-contents/runtime";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeGroups,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../workflows/runtimeInput";
import type { Blobs } from "./blobs";
import type { Database } from "./database";
import type { Events } from "./events";
import type { Identity } from "./identity";
import { createListenerSet } from "./listenerSet";
import type { Network } from "./network";
import { adoptSessionRootContainer } from "./rootContainerAdoption";
import type { Session } from "./session/sessionTypes";
import type { SyncBillingGate } from "./syncBillingGate";

export interface WorkflowRuntimeInput extends WorkflowRuntimeGroups {}

export type RuntimeListener = () => void;

export interface Runtime {
  readonly version: number;
  input(containerId?: string | null | undefined): WorkflowRuntimeInput;
  subscribe(listener: RuntimeListener): () => void;
}

export interface InternalWorkflowRuntimeInput extends WorkflowRuntimeInput {
  readonly apiClient: ApiClient;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface InternalRuntime {
  readonly adoptRootContainer: ContainerContentsRootAdopter;
  readonly publicRuntime: Runtime;
  pinLocalUserIdentity(
    userId: string,
    candidate: LocalUserIdentityCandidate,
  ): Promise<void>;
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
  identityTrustDomain: string | null;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  network: Network;
  peerScope?: string | null;
  session: Session;
  syncBillingGate?: SyncBillingGate | undefined;
}

export function createRuntime(
  dependencies: WorkflowRuntimeDependencies,
): InternalRuntime {
  const trustedUserIdentityService = createTrustedUserIdentityService({
    getExecSql: () =>
      dependencies.database.status === "ready"
        ? dependencies.database.requireExecSql("trusted user identity")
        : null,
    getLocalIdentity: () => {
      const encapsulationKeyPair = dependencies.identity.encapsulationKeyPair;
      const signingKeyPair = dependencies.identity.signingKeyPair;
      if (!encapsulationKeyPair || !signingKeyPair) {
        return null;
      }
      return {
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        signingKeyFingerprint: dependencies.identity.signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      };
    },
    getLocalUserId: () => dependencies.session.userId,
    identityTrustDomain: dependencies.identityTrustDomain,
    remoteSource: createApiUserIdentitySource(dependencies.api),
  });
  const runtimeSubscription = createRuntimeSubscription(dependencies);
  const publicRuntimeInput = createRuntimeInputFactory(
    dependencies,
    trustedUserIdentityService.resolve,
  );
  const internalRuntimeInput = createRuntimeInputFactory(
    dependencies,
    trustedUserIdentityService.resolve,
  );

  return {
    adoptRootContainer: (input) =>
      adoptSessionRootContainer(dependencies, input),
    async pinLocalUserIdentity(userId, candidate) {
      await trustedUserIdentityService.pinLocal(userId, candidate);
    },
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
  const listeners = createListenerSet();
  let version = 0;
  const notifyListeners = () => {
    version += 1;
    listeners.notify();
  };

  dependencies.database.subscribe(notifyListeners);
  dependencies.events.subscribe(notifyListeners);
  dependencies.identity.subscribe(notifyListeners);
  dependencies.network.subscribe(() => notifyListeners());
  dependencies.session.subscribe(notifyListeners);
  dependencies.syncBillingGate?.subscribe(notifyListeners);

  return {
    get version() {
      return version;
    },
    subscribe(listener: RuntimeListener): () => void {
      return listeners.subscribe(listener);
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
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
): RuntimeInputFactory {
  let auth: WorkflowRuntimeAuthInput | undefined;
  let crypto: WorkflowRuntimeCryptoInput | undefined;
  let infra: WorkflowRuntimeInfraInput | undefined;
  let state: WorkflowRuntimeStateInput | undefined;
  let util: WorkflowRuntimeUtilInput | undefined;

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
      defaultOrganizationId: dependencies.session.defaultOrganizationId,
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
      // Resolved sync-online: workflows treat local-only mode exactly like being
      // offline (no server I/O), while `tearleads.network` stays the truthful
      // connectivity signal for host/UI. See Session.syncEnabled.
      online: dependencies.network.online && dependencies.session.syncEnabled,
      peerScope: dependencies.peerScope ?? null,
      serverEventsConnectionGeneration:
        dependencies.events.connectionGeneration,
    });
    if (
      !util ||
      util.log !== dependencies.log ||
      util.logError !== dependencies.logError
    ) {
      util = {
        isRemoteSyncBlocked: (organizationId) =>
          dependencies.syncBillingGate?.isBlockedForOrganization(
            organizationId,
          ) ?? false,
        log: dependencies.log,
        logError: dependencies.logError,
      };
    }

    return createInternalWorkflowRuntimeInput(
      dependencies.api,
      auth,
      crypto,
      infra,
      state,
      util,
      resolveTrustedUserIdentity,
    );
  };

  return {
    hostInput(containerId) {
      const {
        apiClient: _apiClient,
        resolveTrustedUserIdentity: _resolveTrustedUserIdentity,
        ...input
      } = workflowInput(containerId);
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
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
): InternalWorkflowRuntimeInput {
  return {
    apiClient,
    auth,
    crypto,
    infra,
    state,
    util,
    resolveTrustedUserIdentity,
  };
}

function reuseWorkflowRuntimeAuth(
  current: WorkflowRuntimeAuthInput | undefined,
  next: WorkflowRuntimeAuthInput,
): WorkflowRuntimeAuthInput {
  return current &&
    current.defaultOrganizationId === next.defaultOrganizationId &&
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
    current.online === next.online &&
    current.peerScope === next.peerScope &&
    current.serverEventsConnectionGeneration ===
      next.serverEventsConnectionGeneration
    ? current
    : next;
}
