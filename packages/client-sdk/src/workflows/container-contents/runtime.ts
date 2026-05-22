import type { ApiClient } from "@tearleads/api-client";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobContracts";
import {
  type DocumentProjectorRegistry,
  defaultDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
} from "../documents";
import {
  type ContainerContentsProjectionKeyRuntime,
  type ContainerContentsProjectionUserKeyResolver,
  createContainerContentsDocumentProjectionUserKeyResolver,
  createContainerContentsProjectionUserKeyResolver,
  didContainerContentsProjectionKeyRuntimeChange,
} from "./projectionKeys";
import { didRegainContainerContentsSyncPrerequisites } from "./syncLane";

type DocumentsWorkflowRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];

type ContainerContentsWorkflowApi = ApiClient &
  DocumentsWorkflowRuntimeInput["apiClient"];

export interface ContainerContentsWorkflowRuntimeInput {
  readonly apiClient: ContainerContentsWorkflowApi;
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly dbStatus: string;
  readonly documentProjectors?: DocumentProjectorRegistry | undefined;
  readonly domainScope: DomainScope;
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

const containerContentsWorkflowRuntimeExecSql = Symbol(
  "containerContentsWorkflowRuntimeExecSql",
);

export interface ContainerContentsWorkflowSqlRuntime {
  readonly [containerContentsWorkflowRuntimeExecSql]: ExecSql;
}

export interface ContainerContentsWorkflowRuntime
  extends ContainerContentsWorkflowSqlRuntime {
  apiClient: ContainerContentsWorkflowApi;
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  dbStatus: string;
  documentProjectors: DocumentProjectorRegistry;
  domainScope: DomainScope;
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
  createDocumentProjectionUserKeyResolver: () => ContainerContentsProjectionUserKeyResolver;
  createDocumentsRuntime: (containerId: string) => DocumentsWorkflowRuntime;
  createProjectionUserKeyResolver: () => ContainerContentsProjectionUserKeyResolver;
  didProjectionKeyRuntimeChange: (
    previousRuntime: ContainerContentsWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: ContainerContentsWorkflowRuntime,
  ) => boolean;
}

type ContainerContentsWorkflowRuntimeActions = Omit<
  ContainerContentsWorkflowRuntime,
  | keyof ContainerContentsWorkflowRuntimeInput
  | keyof ContainerContentsWorkflowSqlRuntime
  | "createDocumentProjectionUserKeyResolver"
  | "createDocumentsRuntime"
  | "createProjectionUserKeyResolver"
  | "didProjectionKeyRuntimeChange"
  | "didRegainSyncPrerequisites"
> & {
  createDocumentProjectionUserKeyResolver: () => ContainerContentsProjectionUserKeyResolver;
  createDocumentsRuntime: (containerId: string) => DocumentsWorkflowRuntime;
  createProjectionUserKeyResolver: () => ContainerContentsProjectionUserKeyResolver;
  didProjectionKeyRuntimeChange: (
    previousRuntime: ContainerContentsWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: ContainerContentsWorkflowRuntime,
  ) => boolean;
};

export function getContainerContentsWorkflowRuntimeExecSql(
  runtime: ContainerContentsWorkflowSqlRuntime,
): ExecSql {
  return runtime[containerContentsWorkflowRuntimeExecSql];
}

export function createContainerContentsWorkflowSqlRuntime(input: {
  execSql: ExecSql;
}): ContainerContentsWorkflowSqlRuntime {
  return {
    [containerContentsWorkflowRuntimeExecSql]: input.execSql,
  };
}

function containerContentsProjectionRuntime(
  runtime: ContainerContentsWorkflowRuntime,
): ContainerContentsProjectionKeyRuntime {
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
  runtime: ContainerContentsWorkflowRuntime,
  containerId: string,
): DocumentsWorkflowRuntimeInput {
  return {
    apiClient: runtime.apiClient,
    blobStore: runtime.blobStore,
    cacheReferencedPrincipalPolicies: runtime.cacheReferencedPrincipalPolicies,
    containerId,
    dbStatus: runtime.dbStatus,
    documentProjectors: runtime.documentProjectors,
    domainScope: runtime.domainScope,
    encapsulationKeyPair: runtime.encapsulationKeyPair ?? null,
    events: runtime.events,
    execSql: getContainerContentsWorkflowRuntimeExecSql(runtime),
    isAuthenticated: runtime.isAuthenticated,
    log: runtime.log,
    online: runtime.online,
    organizationId: runtime.organizationId ?? null,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    userId: runtime.userId ?? null,
  };
}

function createContainerContentsWorkflowRuntimeActions(): ContainerContentsWorkflowRuntimeActions {
  return {
    createDocumentProjectionUserKeyResolver(
      this: ContainerContentsWorkflowRuntime,
    ) {
      return createContainerContentsDocumentProjectionUserKeyResolver(
        containerContentsProjectionRuntime(this),
      );
    },
    createDocumentsRuntime(
      this: ContainerContentsWorkflowRuntime,
      containerId,
    ) {
      return createDocumentsWorkflowRuntime(
        documentsRuntimeInput(this, containerId),
      );
    },
    createProjectionUserKeyResolver(this: ContainerContentsWorkflowRuntime) {
      return createContainerContentsProjectionUserKeyResolver(
        containerContentsProjectionRuntime(this),
      );
    },
    didProjectionKeyRuntimeChange(
      this: ContainerContentsWorkflowRuntime,
      previousRuntime,
    ) {
      return didContainerContentsProjectionKeyRuntimeChange(
        containerContentsProjectionRuntime(previousRuntime),
        containerContentsProjectionRuntime(this),
      );
    },
    didRegainSyncPrerequisites(
      this: ContainerContentsWorkflowRuntime,
      previousRuntime,
    ) {
      return didRegainContainerContentsSyncPrerequisites(previousRuntime, this);
    },
  };
}

export function createContainerContentsWorkflowRuntime(
  input: ContainerContentsWorkflowRuntimeInput,
): ContainerContentsWorkflowRuntime {
  return {
    [containerContentsWorkflowRuntimeExecSql]: input.execSql,
    apiClient: input.apiClient,
    blobStore: input.blobStore,
    cacheReferencedPrincipalPolicies: input.cacheReferencedPrincipalPolicies,
    dbStatus: input.dbStatus,
    documentProjectors:
      input.documentProjectors ?? defaultDocumentProjectorRegistry,
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
    ...createContainerContentsWorkflowRuntimeActions(),
  };
}
