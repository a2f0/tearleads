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
  extends ContainerContentsWorkflowRuntimeUtilInput {
  // Store recovery is best-effort, so hosts may retain the causal error without
  // making structured error logging mandatory for general workflow runtimes.
  readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
}

export interface ContainerContentsRootAdoptionInput {
  readonly domainScope: ContainerContentsWorkflowRuntimeState["domainScope"];
  readonly expectedContainerId: string;
  readonly nextContainerId: string;
  readonly organizationId: string;
  readonly userId: string;
}

export type ContainerContentsRootAdopter = (
  input: ContainerContentsRootAdoptionInput,
) => boolean | "already-adopted";

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
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface ContainerContentsWorkflowRuntime
  extends ContainerContentsWorkflowRuntimeGroups,
    Pick<ContainerContentsWorkflowRuntimeInput, "apiClient"> {
  readonly adoptRootContainer?: ContainerContentsRootAdopter | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface ContainerContentsStoreWorkflowRuntime
  extends ContainerContentsWorkflowRuntime {
  readonly adoptRootContainer: ContainerContentsRootAdopter;
}

export interface ContainerContentsWorkflowSqlRuntime {
  readonly infra: {
    readonly execSql: ExecSql;
  };
}

function documentsRuntimeInput(
  runtime: ContainerContentsWorkflowRuntime,
  containerId: string | null,
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
  containerId: string | null,
): DocumentsWorkflowRuntime {
  return createDocumentsWorkflowRuntime(
    documentsRuntimeInput(runtime, containerId),
  );
}

function createContainerContentsWorkflowRuntimeWithRootAdopter(
  input: ContainerContentsWorkflowRuntimeInput,
  adoptRootContainer?: ContainerContentsRootAdopter | undefined,
): ContainerContentsWorkflowRuntime {
  const documentProjectors = resolveDocumentProjectorRegistry(
    input.infra.documentProjectors,
  );
  const infra = {
    ...input.infra,
    documentProjectors,
  };

  return {
    ...(adoptRootContainer ? { adoptRootContainer } : {}),
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

export function createContainerContentsWorkflowRuntime(
  input: ContainerContentsWorkflowRuntimeInput,
): ContainerContentsWorkflowRuntime {
  return createContainerContentsWorkflowRuntimeWithRootAdopter(input);
}

/** Internal store runtime with the session-root adoption capability wired. */
export function createContainerContentsStoreWorkflowRuntime(
  input: ContainerContentsWorkflowRuntimeInput,
  adoptRootContainer: ContainerContentsRootAdopter,
): ContainerContentsStoreWorkflowRuntime {
  return {
    ...createContainerContentsWorkflowRuntimeWithRootAdopter(
      input,
      adoptRootContainer,
    ),
    adoptRootContainer,
  };
}
