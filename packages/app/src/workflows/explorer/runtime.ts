import type { ApiClient } from "@tearleads/api-client";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobContracts";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
} from "../documents";
import {
  createExplorerDocumentProjectionUserKeyResolver,
  createExplorerProjectionUserKeyResolver,
  didExplorerProjectionKeyRuntimeChange,
  type ExplorerProjectionKeyRuntime,
  type ExplorerProjectionUserKeyResolver,
} from "./projectionKeys";
import { didRegainExplorerSyncPrerequisites } from "./syncLane";

type DocumentsWorkflowRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];

type ExplorerWorkflowApi = ApiClient &
  DocumentsWorkflowRuntimeInput["apiClient"];

export interface ExplorerWorkflowRuntimeInput {
  readonly apiClient: ExplorerWorkflowApi;
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly dbStatus: string;
  readonly domainScope: object;
  readonly encapsulationKeyPair?:
    | {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      }
    | null
    | undefined;
  readonly events: ReadonlyArray<unknown>;
  readonly execSql: ExecSql;
  readonly isAuthenticated: boolean;
  readonly log: (message: string) => void;
  readonly online: boolean;
  readonly organizationId?: string | null | undefined;
  readonly signingFingerprint?: string | null | undefined;
  readonly signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  readonly userId?: string | null | undefined;
}

const explorerWorkflowRuntimeExecSql = Symbol("explorerWorkflowRuntimeExecSql");

export interface ExplorerWorkflowSqlRuntime {
  readonly [explorerWorkflowRuntimeExecSql]: ExecSql;
}

export interface ExplorerWorkflowRuntime extends ExplorerWorkflowSqlRuntime {
  apiClient: ExplorerWorkflowApi;
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  dbStatus: string;
  domainScope: object;
  encapsulationKeyPair: {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  } | null;
  events: ReadonlyArray<unknown>;
  isAuthenticated: boolean;
  log: (message: string) => void;
  online: boolean;
  organizationId: string | null;
  signingFingerprint: string | null;
  signingKeyPair: {
    signingPrivateKey: Uint8Array;
    signingPublicKey: Uint8Array;
  } | null;
  userId: string | null;
  createDocumentProjectionUserKeyResolver: () => ExplorerProjectionUserKeyResolver;
  createDocumentsRuntime: (containerId: string) => DocumentsWorkflowRuntime;
  createProjectionUserKeyResolver: () => ExplorerProjectionUserKeyResolver;
  didProjectionKeyRuntimeChange: (
    previousRuntime: ExplorerWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: ExplorerWorkflowRuntime,
  ) => boolean;
}

type ExplorerWorkflowRuntimeActions = Omit<
  ExplorerWorkflowRuntime,
  | keyof ExplorerWorkflowRuntimeInput
  | keyof ExplorerWorkflowSqlRuntime
  | "createDocumentProjectionUserKeyResolver"
  | "createDocumentsRuntime"
  | "createProjectionUserKeyResolver"
  | "didProjectionKeyRuntimeChange"
  | "didRegainSyncPrerequisites"
> & {
  createDocumentProjectionUserKeyResolver: () => ExplorerProjectionUserKeyResolver;
  createDocumentsRuntime: (containerId: string) => DocumentsWorkflowRuntime;
  createProjectionUserKeyResolver: () => ExplorerProjectionUserKeyResolver;
  didProjectionKeyRuntimeChange: (
    previousRuntime: ExplorerWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: ExplorerWorkflowRuntime,
  ) => boolean;
};

export function getExplorerWorkflowRuntimeExecSql(
  runtime: ExplorerWorkflowSqlRuntime,
): ExecSql {
  return runtime[explorerWorkflowRuntimeExecSql];
}

export function createExplorerWorkflowSqlRuntime(input: {
  execSql: ExecSql;
}): ExplorerWorkflowSqlRuntime {
  return {
    [explorerWorkflowRuntimeExecSql]: input.execSql,
  };
}

function explorerProjectionRuntime(
  runtime: ExplorerWorkflowRuntime,
): ExplorerProjectionKeyRuntime {
  return {
    apiClient: runtime.apiClient,
    encapsulationKeyPair: runtime.encapsulationKeyPair ?? null,
    log: runtime.log,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    userId: runtime.userId ?? null,
  };
}

function documentsRuntimeInput(
  runtime: ExplorerWorkflowRuntime,
  containerId: string,
): DocumentsWorkflowRuntimeInput {
  return {
    apiClient: runtime.apiClient,
    blobStore: runtime.blobStore,
    cacheReferencedPrincipalPolicies: runtime.cacheReferencedPrincipalPolicies,
    containerId,
    dbStatus: runtime.dbStatus,
    domainScope: runtime.domainScope,
    encapsulationKeyPair: runtime.encapsulationKeyPair ?? null,
    events: runtime.events,
    execSql: getExplorerWorkflowRuntimeExecSql(runtime),
    isAuthenticated: runtime.isAuthenticated,
    log: runtime.log,
    online: runtime.online,
    organizationId: runtime.organizationId ?? null,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    userId: runtime.userId ?? null,
  };
}

function createExplorerWorkflowRuntimeActions(): ExplorerWorkflowRuntimeActions {
  return {
    createDocumentProjectionUserKeyResolver(this: ExplorerWorkflowRuntime) {
      return createExplorerDocumentProjectionUserKeyResolver(
        explorerProjectionRuntime(this),
      );
    },
    createDocumentsRuntime(this: ExplorerWorkflowRuntime, containerId) {
      return createDocumentsWorkflowRuntime(
        documentsRuntimeInput(this, containerId),
      );
    },
    createProjectionUserKeyResolver(this: ExplorerWorkflowRuntime) {
      return createExplorerProjectionUserKeyResolver(
        explorerProjectionRuntime(this),
      );
    },
    didProjectionKeyRuntimeChange(
      this: ExplorerWorkflowRuntime,
      previousRuntime,
    ) {
      return didExplorerProjectionKeyRuntimeChange(
        explorerProjectionRuntime(previousRuntime),
        explorerProjectionRuntime(this),
      );
    },
    didRegainSyncPrerequisites(this: ExplorerWorkflowRuntime, previousRuntime) {
      return didRegainExplorerSyncPrerequisites(previousRuntime, this);
    },
  };
}

export function createExplorerWorkflowRuntime(
  input: ExplorerWorkflowRuntimeInput,
): ExplorerWorkflowRuntime {
  return {
    [explorerWorkflowRuntimeExecSql]: input.execSql,
    apiClient: input.apiClient,
    blobStore: input.blobStore,
    cacheReferencedPrincipalPolicies: input.cacheReferencedPrincipalPolicies,
    dbStatus: input.dbStatus,
    domainScope: input.domainScope,
    encapsulationKeyPair: input.encapsulationKeyPair ?? null,
    events: input.events,
    isAuthenticated: input.isAuthenticated,
    log: input.log,
    online: input.online,
    organizationId: input.organizationId ?? null,
    signingFingerprint: input.signingFingerprint ?? null,
    signingKeyPair: input.signingKeyPair ?? null,
    userId: input.userId ?? null,
    ...createExplorerWorkflowRuntimeActions(),
  };
}
