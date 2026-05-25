import type { ApiClient } from "@tearleads/api-client";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobContracts";
import {
  type DocumentProjectorRegistry,
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
} from "../documents";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../runtimeInput";

type DocumentsWorkflowRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];

type ContainerContentsWorkflowApi = ApiClient &
  DocumentsWorkflowRuntimeInput["apiClient"];
type ContainerContentsWorkflowRuntimeAuthInput = Omit<
  WorkflowRuntimeAuthInput,
  "organizationId" | "userId"
> & {
  readonly organizationId?: string | null | undefined;
  readonly userId?: string | null | undefined;
};
type ContainerContentsWorkflowRuntimeCryptoInput =
  Partial<WorkflowRuntimeCryptoInput>;
type ContainerContentsWorkflowRuntimeInfraInput = Omit<
  WorkflowRuntimeInfraInput,
  "dbStatus" | "documentProjectors"
> & {
  readonly dbStatus: string;
  readonly documentProjectors?: DocumentProjectorRegistryInput | undefined;
};
type ContainerContentsWorkflowRuntimeStateInput = Omit<
  WorkflowRuntimeStateInput,
  "containerId"
> & {
  readonly containerId?: string | null | undefined;
};
type ContainerContentsWorkflowRuntimeUtilInput = Omit<
  WorkflowRuntimeUtilInput,
  "logError"
>;

export interface ContainerContentsWorkflowRuntimeAuth
  extends WorkflowRuntimeAuthInput {}

export interface ContainerContentsWorkflowRuntimeCrypto
  extends WorkflowRuntimeCryptoInput {}

export interface ContainerContentsWorkflowRuntimeInfra
  extends Omit<WorkflowRuntimeInfraInput, "dbStatus"> {
  readonly dbStatus: string;
}

export interface ContainerContentsWorkflowRuntimeState
  extends WorkflowRuntimeStateInput {}

export interface ContainerContentsWorkflowRuntimeUtil
  extends ContainerContentsWorkflowRuntimeUtilInput {}

export interface ContainerContentsWorkflowRuntimeGroups {
  readonly auth: ContainerContentsWorkflowRuntimeAuth;
  readonly crypto: ContainerContentsWorkflowRuntimeCrypto;
  readonly infra: ContainerContentsWorkflowRuntimeInfra;
  readonly state: ContainerContentsWorkflowRuntimeState;
  readonly util: ContainerContentsWorkflowRuntimeUtil;
}

export interface ContainerContentsWorkflowRuntimeInputGroups {
  readonly auth?: ContainerContentsWorkflowRuntimeAuthInput | undefined;
  readonly crypto?: ContainerContentsWorkflowRuntimeCryptoInput | undefined;
  readonly infra?: ContainerContentsWorkflowRuntimeInfraInput | undefined;
  readonly state?: ContainerContentsWorkflowRuntimeStateInput | undefined;
  readonly util?: ContainerContentsWorkflowRuntimeUtilInput | undefined;
}

export interface ContainerContentsWorkflowRuntimeInput
  extends ContainerContentsWorkflowRuntimeInputGroups {
  readonly apiClient: ContainerContentsWorkflowApi;
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly dbStatus: string;
  readonly documentProjectors?: DocumentProjectorRegistryInput | undefined;
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
  extends ContainerContentsWorkflowRuntimeGroups,
    ContainerContentsWorkflowSqlRuntime,
    Omit<
      ContainerContentsWorkflowRuntimeInput,
      | "auth"
      | "crypto"
      | "documentProjectors"
      | "encapsulationKeyPair"
      | "execSql"
      | "infra"
      | "organizationId"
      | "signingFingerprint"
      | "signingKeyPair"
      | "state"
      | "util"
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
    auth: runtime.auth,
    blobStore: runtime.blobStore,
    cacheReferencedPrincipalPolicies: runtime.cacheReferencedPrincipalPolicies,
    containerId,
    crypto: runtime.crypto,
    dbStatus: runtime.dbStatus,
    documentProjectors: runtime.documentProjectors,
    domainScope: runtime.domainScope,
    encapsulationKeyPair: runtime.encapsulationKeyPair ?? null,
    events: runtime.events,
    execSql: runtime.execSql,
    infra: runtime.infra,
    isAuthenticated: runtime.isAuthenticated,
    log: runtime.log,
    online: runtime.online,
    organizationId: runtime.organizationId ?? null,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    state: { ...runtime.state, containerId },
    userId: runtime.userId ?? null,
    util: runtime.util,
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
  const documentProjectors = resolveDocumentProjectorRegistry(
    input.infra?.documentProjectors ?? input.documentProjectors,
  );
  const auth = {
    isAuthenticated: input.auth?.isAuthenticated ?? input.isAuthenticated,
    organizationId: input.auth?.organizationId ?? input.organizationId ?? null,
    userId: input.auth?.userId ?? input.userId ?? null,
  };
  const crypto = {
    encapsulationKeyPair:
      input.crypto?.encapsulationKeyPair ?? input.encapsulationKeyPair ?? null,
    signingFingerprint:
      input.crypto?.signingFingerprint ?? input.signingFingerprint ?? null,
    signingKeyPair:
      input.crypto?.signingKeyPair ?? input.signingKeyPair ?? null,
  };
  const infra = {
    blobStore: input.infra?.blobStore ?? input.blobStore,
    dbStatus: input.infra?.dbStatus ?? input.dbStatus,
    documentProjectors,
    execSql: input.infra?.execSql ?? input.execSql,
  };
  const state = {
    containerId: input.state?.containerId ?? null,
    domainScope: input.state?.domainScope ?? input.domainScope,
    events: input.state?.events ?? input.events,
    online: input.state?.online ?? input.online,
  };
  const util = {
    cacheReferencedPrincipalPolicies:
      input.util?.cacheReferencedPrincipalPolicies ??
      input.cacheReferencedPrincipalPolicies,
    log: input.util?.log ?? input.log,
  };

  return {
    apiClient: input.apiClient,
    auth,
    blobStore: infra.blobStore,
    cacheReferencedPrincipalPolicies: util.cacheReferencedPrincipalPolicies,
    crypto,
    dbStatus: infra.dbStatus,
    documentProjectors,
    domainScope: state.domainScope,
    encapsulationKeyPair: crypto.encapsulationKeyPair,
    events: state.events,
    execSql: infra.execSql,
    infra,
    isAuthenticated: auth.isAuthenticated,
    log: util.log,
    online: state.online,
    organizationId: auth.organizationId,
    signingFingerprint: crypto.signingFingerprint,
    signingKeyPair: crypto.signingKeyPair,
    state,
    userId: auth.userId,
    util,
  };
}
