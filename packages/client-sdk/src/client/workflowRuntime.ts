import type { ApiClient } from "@tearleads/api-client";
import type { DocumentProjectorRegistry } from "../data/documents/documentKinds";
import type { DomainScope } from "../data/domainScope";
import { runWithSecurityIncidentReporting } from "../data/keyingProjectionVerification/error";
import type { SecurityIncidentReporter } from "../data/securityIncidents";
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
  reportSecurityIncident: SecurityIncidentReporter;
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
  const resolveTrustedUserIdentity: TrustedUserIdentityResolver = (userId) =>
    runWithSecurityIncidentReporting(
      dependencies.reportSecurityIncident,
      {
        objectId: userId,
        objectKind: "user",
        operation: "user.identity.resolve",
        organizationId: dependencies.session.organizationId,
      },
      () => trustedUserIdentityService.resolve(userId),
    );
  const runtimeSubscription = createRuntimeSubscription(dependencies);
  const runtimeInput = createRuntimeInputFactory(
    dependencies,
    resolveTrustedUserIdentity,
  );

  return {
    adoptRootContainer: (input) =>
      adoptSessionRootContainer(dependencies, input),
    async pinLocalUserIdentity(userId, candidate) {
      await runWithSecurityIncidentReporting(
        dependencies.reportSecurityIncident,
        {
          objectId: userId,
          objectKind: "user",
          operation: "user.identity.pin_local",
          organizationId: dependencies.session.organizationId,
        },
        () => trustedUserIdentityService.pinLocal(userId, candidate),
      );
    },
    publicRuntime: {
      get version() {
        return runtimeSubscription.version;
      },
      input: runtimeInput.hostInput,
      subscribe: runtimeSubscription.subscribe,
    },
    workflowInput: runtimeInput.workflowInput,
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

    auth = reuseIfShallowEqual(auth, {
      defaultOrganizationId: dependencies.session.defaultOrganizationId,
      isAuthenticated: dependencies.session.isAuthenticated,
      organizationId: dependencies.session.organizationId,
      userId: dependencies.session.userId,
    });
    crypto = reuseIfShallowEqual(crypto, {
      encapsulationKeyPair: dependencies.identity.encapsulationKeyPair,
      signingFingerprint: dependencies.identity.signingFingerprint,
      signingKeyPair: dependencies.identity.signingKeyPair,
    });
    infra = reuseIfShallowEqual(infra, {
      blobStore: dependencies.blobs.store,
      dbStatus,
      documentProjectors: dependencies.documentProjectors,
      // Runtime consumers branch on dbStatus before touching SQLite. The
      // fallback preserves the runtime shape and catches lifecycle bugs.
      execSql,
    });
    state = reuseIfShallowEqual(state, {
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
      util.logError !== dependencies.logError ||
      util.reportSecurityIncident !== dependencies.reportSecurityIncident
    ) {
      util = {
        isRemoteSyncBlocked: (organizationId) =>
          dependencies.syncBillingGate?.isBlockedForOrganization(
            organizationId,
          ) ?? false,
        log: dependencies.log,
        logError: dependencies.logError,
        reportSecurityIncident: dependencies.reportSecurityIncident,
      };
    }

    return {
      apiClient: dependencies.api,
      auth,
      crypto,
      infra,
      state,
      util,
      resolveTrustedUserIdentity,
    };
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

/**
 * Reuses the current runtime-input group when every field of the freshly
 * constructed `next` literal is reference-equal, so unchanged groups keep a
 * stable identity across runtime reads.
 */
function reuseIfShallowEqual<T extends object>(
  current: T | undefined,
  next: T,
): T {
  if (!current) {
    return next;
  }
  for (const key of Object.keys(next)) {
    if (Reflect.get(current, key) !== Reflect.get(next, key)) {
      return next;
    }
  }
  return current;
}
