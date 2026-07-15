import type { ApiClient } from "@tearleads/api-client";
import {
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
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

interface ContainerContentsWorkflowRuntimeInputInfra
  extends Omit<ContainerContentsWorkflowRuntimeInfra, "documentProjectors"> {
  readonly documentProjectors: DocumentProjectorRegistryInput;
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
  readonly auth: ContainerContentsWorkflowRuntimeAuth;
  readonly crypto: ContainerContentsWorkflowRuntimeCrypto;
  readonly infra: ContainerContentsWorkflowRuntimeInputInfra;
  readonly state: ContainerContentsWorkflowRuntimeState;
  readonly util: ContainerContentsWorkflowRuntimeUtil;
}

export interface ContainerContentsWorkflowRuntimeInput
  extends ContainerContentsWorkflowRuntimeInputGroups {
  readonly apiClient: ContainerContentsWorkflowApi;
  readonly resolveTrustedUserIdentity?: TrustedUserIdentityResolver | undefined;
}

export interface ContainerContentsWorkflowRuntime
  extends ContainerContentsWorkflowRuntimeGroups,
    Pick<ContainerContentsWorkflowRuntimeInput, "apiClient"> {
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface ContainerContentsWorkflowSqlRuntime {
  readonly infra: {
    readonly execSql: ExecSql;
  };
}

function documentsRuntimeInput(
  runtime: ContainerContentsWorkflowRuntime,
  containerId: string,
): DocumentsWorkflowRuntimeInput {
  return {
    apiClient: runtime.apiClient,
    auth: runtime.auth,
    crypto: runtime.crypto,
    infra: runtime.infra,
    resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
    state: { ...runtime.state, containerId },
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
    input.infra.documentProjectors,
  );
  const infra = {
    ...input.infra,
    documentProjectors,
  };

  return {
    apiClient: input.apiClient,
    auth: input.auth,
    crypto: input.crypto,
    infra,
    resolveTrustedUserIdentity: requireTrustedUserIdentityResolver(
      input.resolveTrustedUserIdentity,
    ),
    state: input.state,
    util: input.util,
  };
}
