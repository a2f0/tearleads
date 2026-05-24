import type { ApiClient } from "@tearleads/api-client";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
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
  readonly encapsulationKeyPair?: EncapsulationKeyPair | null | undefined;
  readonly events: ReadonlyArray<unknown>;
  readonly execSql: ExecSql;
  readonly isAuthenticated: boolean;
  readonly log: (message: string) => void;
  readonly online: boolean;
  readonly organizationId?: string | null | undefined;
  readonly signingFingerprint?: string | null | undefined;
  readonly signingKeyPair?: SigningKeyPair | null | undefined;
  readonly userId?: string | null | undefined;
}

export interface ContainerContentsWorkflowSqlRuntime {
  readonly execSql: ExecSql;
}

export interface ContainerContentsWorkflowRuntime
  extends ContainerContentsWorkflowSqlRuntime,
    Omit<
      ContainerContentsWorkflowRuntimeInput,
      | "documentProjectors"
      | "encapsulationKeyPair"
      | "execSql"
      | "organizationId"
      | "signingFingerprint"
      | "signingKeyPair"
      | "userId"
    > {
  readonly documentProjectors: DocumentProjectorRegistry;
  readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  readonly organizationId: string | null;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: SigningKeyPair | null;
  readonly userId: string | null;
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
    execSql: runtime.execSql,
    isAuthenticated: runtime.isAuthenticated,
    log: runtime.log,
    online: runtime.online,
    organizationId: runtime.organizationId ?? null,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    userId: runtime.userId ?? null,
  };
}

export function createContainerContentsDocumentsRuntime(
  runtime: ContainerContentsWorkflowRuntime,
  containerId: string,
): DocumentsWorkflowRuntime {
  return createDocumentsWorkflowRuntime(
    documentsRuntimeInput(runtime, containerId),
  );
}

export function createContainerContentsWorkflowRuntime(
  input: ContainerContentsWorkflowRuntimeInput,
): ContainerContentsWorkflowRuntime {
  return {
    apiClient: input.apiClient,
    blobStore: input.blobStore,
    cacheReferencedPrincipalPolicies: input.cacheReferencedPrincipalPolicies,
    dbStatus: input.dbStatus,
    documentProjectors:
      input.documentProjectors ?? defaultDocumentProjectorRegistry,
    domainScope: input.domainScope,
    encapsulationKeyPair: input.encapsulationKeyPair ?? null,
    events: input.events,
    execSql: input.execSql,
    isAuthenticated: input.isAuthenticated,
    log: input.log,
    online: input.online,
    organizationId: input.organizationId ?? null,
    signingFingerprint: input.signingFingerprint ?? null,
    signingKeyPair: input.signingKeyPair ?? null,
    userId: input.userId ?? null,
  };
}
