import type { ApiClient } from "@tearleads/api-client";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobContracts";
import {
  type DocumentProjectorRegistry,
  defaultDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
} from "../documents";
import {
  type ContainerDocumentsProjectionKeyRuntime,
  type ContainerDocumentsProjectionUserKeyResolver,
  createContainerDocumentsDocumentProjectionUserKeyResolver,
  createContainerDocumentsProjectionUserKeyResolver,
  didContainerDocumentsProjectionKeyRuntimeChange,
} from "./projectionKeys";
import { didRegainContainerDocumentsSyncPrerequisites } from "./syncLane";

type DocumentsWorkflowRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];

type ContainerDocumentsWorkflowApi = ApiClient &
  DocumentsWorkflowRuntimeInput["apiClient"];

export interface ContainerDocumentsWorkflowRuntimeInput {
  readonly apiClient: ContainerDocumentsWorkflowApi;
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly dbStatus: string;
  readonly documentProjectors?: DocumentProjectorRegistry | undefined;
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

const containerDocumentsWorkflowRuntimeExecSql = Symbol(
  "containerDocumentsWorkflowRuntimeExecSql",
);

export interface ContainerDocumentsWorkflowSqlRuntime {
  readonly [containerDocumentsWorkflowRuntimeExecSql]: ExecSql;
}

export interface ContainerDocumentsWorkflowRuntime
  extends ContainerDocumentsWorkflowSqlRuntime {
  apiClient: ContainerDocumentsWorkflowApi;
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  dbStatus: string;
  documentProjectors: DocumentProjectorRegistry;
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
  createDocumentProjectionUserKeyResolver: () => ContainerDocumentsProjectionUserKeyResolver;
  createDocumentsRuntime: (containerId: string) => DocumentsWorkflowRuntime;
  createProjectionUserKeyResolver: () => ContainerDocumentsProjectionUserKeyResolver;
  didProjectionKeyRuntimeChange: (
    previousRuntime: ContainerDocumentsWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: ContainerDocumentsWorkflowRuntime,
  ) => boolean;
}

type ContainerDocumentsWorkflowRuntimeActions = Omit<
  ContainerDocumentsWorkflowRuntime,
  | keyof ContainerDocumentsWorkflowRuntimeInput
  | keyof ContainerDocumentsWorkflowSqlRuntime
  | "createDocumentProjectionUserKeyResolver"
  | "createDocumentsRuntime"
  | "createProjectionUserKeyResolver"
  | "didProjectionKeyRuntimeChange"
  | "didRegainSyncPrerequisites"
> & {
  createDocumentProjectionUserKeyResolver: () => ContainerDocumentsProjectionUserKeyResolver;
  createDocumentsRuntime: (containerId: string) => DocumentsWorkflowRuntime;
  createProjectionUserKeyResolver: () => ContainerDocumentsProjectionUserKeyResolver;
  didProjectionKeyRuntimeChange: (
    previousRuntime: ContainerDocumentsWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: ContainerDocumentsWorkflowRuntime,
  ) => boolean;
};

export function getContainerDocumentsWorkflowRuntimeExecSql(
  runtime: ContainerDocumentsWorkflowSqlRuntime,
): ExecSql {
  return runtime[containerDocumentsWorkflowRuntimeExecSql];
}

export function createContainerDocumentsWorkflowSqlRuntime(input: {
  execSql: ExecSql;
}): ContainerDocumentsWorkflowSqlRuntime {
  return {
    [containerDocumentsWorkflowRuntimeExecSql]: input.execSql,
  };
}

function containerDocumentsProjectionRuntime(
  runtime: ContainerDocumentsWorkflowRuntime,
): ContainerDocumentsProjectionKeyRuntime {
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
  runtime: ContainerDocumentsWorkflowRuntime,
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
    execSql: getContainerDocumentsWorkflowRuntimeExecSql(runtime),
    isAuthenticated: runtime.isAuthenticated,
    log: runtime.log,
    online: runtime.online,
    organizationId: runtime.organizationId ?? null,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    userId: runtime.userId ?? null,
  };
}

function createContainerDocumentsWorkflowRuntimeActions(): ContainerDocumentsWorkflowRuntimeActions {
  return {
    createDocumentProjectionUserKeyResolver(
      this: ContainerDocumentsWorkflowRuntime,
    ) {
      return createContainerDocumentsDocumentProjectionUserKeyResolver(
        containerDocumentsProjectionRuntime(this),
      );
    },
    createDocumentsRuntime(
      this: ContainerDocumentsWorkflowRuntime,
      containerId,
    ) {
      return createDocumentsWorkflowRuntime(
        documentsRuntimeInput(this, containerId),
      );
    },
    createProjectionUserKeyResolver(this: ContainerDocumentsWorkflowRuntime) {
      return createContainerDocumentsProjectionUserKeyResolver(
        containerDocumentsProjectionRuntime(this),
      );
    },
    didProjectionKeyRuntimeChange(
      this: ContainerDocumentsWorkflowRuntime,
      previousRuntime,
    ) {
      return didContainerDocumentsProjectionKeyRuntimeChange(
        containerDocumentsProjectionRuntime(previousRuntime),
        containerDocumentsProjectionRuntime(this),
      );
    },
    didRegainSyncPrerequisites(
      this: ContainerDocumentsWorkflowRuntime,
      previousRuntime,
    ) {
      return didRegainContainerDocumentsSyncPrerequisites(
        previousRuntime,
        this,
      );
    },
  };
}

export function createContainerDocumentsWorkflowRuntime(
  input: ContainerDocumentsWorkflowRuntimeInput,
): ContainerDocumentsWorkflowRuntime {
  return {
    [containerDocumentsWorkflowRuntimeExecSql]: input.execSql,
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
    ...createContainerDocumentsWorkflowRuntimeActions(),
  };
}
