import type { ApiClient } from "@tearleads/api-client";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../data/blobContracts";
import type { DocumentProjectorRegistry } from "../data/documents/documentKinds";
import { type ExecSql, unavailableExecSql } from "../data/sqlite/sqlSchema";
import { cacheReferencedPrincipalPolicies } from "../workflows/principals";
import type { TearleadsBlobs } from "./blobs";
import type { TearleadsDatabase, TearleadsDatabaseStatus } from "./database";
import type { TearleadsEvents } from "./events";
import type { TearleadsIdentity } from "./identity";
import type { TearleadsNetwork } from "./network";
import type { TearleadsSession } from "./session";

export interface TearleadsWorkflowRuntimeInput {
  apiClient: ApiClient;
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  containerId: string | null;
  dbStatus: TearleadsDatabaseStatus;
  documentProjectors: DocumentProjectorRegistry;
  domainScope: object;
  encapsulationKeyPair: EncapsulationKeyPair | null;
  events: ReadonlyArray<unknown>;
  execSql: ExecSql;
  isAuthenticated: boolean;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  online: boolean;
  organizationId: string | null;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
  userId: string | null;
}

export interface TearleadsRuntime {
  input(containerId?: string | null | undefined): TearleadsWorkflowRuntimeInput;
}

interface TearleadsWorkflowRuntimeDependencies {
  api: ApiClient;
  blobs: TearleadsBlobs;
  database: TearleadsDatabase;
  documentProjectors: DocumentProjectorRegistry;
  events: TearleadsEvents;
  getDomainScope: () => object;
  identity: TearleadsIdentity;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
  network: TearleadsNetwork;
  session: TearleadsSession;
}

export function createTearleadsRuntime(
  dependencies: TearleadsWorkflowRuntimeDependencies,
): TearleadsRuntime {
  return {
    input: (containerId) =>
      createTearleadsWorkflowRuntimeInput(dependencies, containerId),
  };
}

function createTearleadsWorkflowRuntimeInput(
  dependencies: TearleadsWorkflowRuntimeDependencies,
  containerId?: string | null | undefined,
): TearleadsWorkflowRuntimeInput {
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
    containerId: containerId ?? null,
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
