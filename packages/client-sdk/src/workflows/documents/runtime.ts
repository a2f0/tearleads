import type { ApiClient } from "@tearleads/api-client";
import {
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../runtimeInput";

type DocumentsWorkflowApi = Pick<ApiClient, keyof ApiClient>;
type DocumentsWorkflowRuntimeUtilInput = Omit<
  WorkflowRuntimeUtilInput,
  "logError"
>;

export interface DocumentsWorkflowRuntimeAuth
  extends WorkflowRuntimeAuthInput {}

export interface DocumentsWorkflowRuntimeCrypto
  extends WorkflowRuntimeCryptoInput {}

export interface DocumentsWorkflowRuntimeInfra
  extends Omit<WorkflowRuntimeInfraInput, "dbStatus"> {
  readonly dbStatus: string;
}

interface DocumentsWorkflowRuntimeInputInfra
  extends Omit<DocumentsWorkflowRuntimeInfra, "documentProjectors"> {
  readonly documentProjectors: DocumentProjectorRegistryInput;
}

export interface DocumentsWorkflowRuntimeState
  extends WorkflowRuntimeStateInput {}

export interface DocumentsWorkflowRuntimeUtil
  extends DocumentsWorkflowRuntimeUtilInput {}

export interface DocumentsWorkflowRuntimeGroups {
  readonly auth: DocumentsWorkflowRuntimeAuth;
  readonly crypto: DocumentsWorkflowRuntimeCrypto;
  readonly infra: DocumentsWorkflowRuntimeInfra;
  readonly state: DocumentsWorkflowRuntimeState;
  readonly util: DocumentsWorkflowRuntimeUtil;
}

export interface DocumentsWorkflowRuntimeInputGroups {
  readonly auth: DocumentsWorkflowRuntimeAuth;
  readonly crypto: DocumentsWorkflowRuntimeCrypto;
  readonly infra: DocumentsWorkflowRuntimeInputInfra;
  readonly state: DocumentsWorkflowRuntimeState;
  readonly util: DocumentsWorkflowRuntimeUtil;
}

export interface DocumentsWorkflowRuntimeInput
  extends DocumentsWorkflowRuntimeInputGroups {
  readonly apiClient: DocumentsWorkflowApi;
}

export interface DocumentsWorkflowRuntime
  extends DocumentsWorkflowRuntimeGroups {
  readonly apiClient: DocumentsWorkflowApi;
}

export function createDocumentsWorkflowRuntime(
  input: DocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntime {
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
    state: input.state,
    util: input.util,
  };
}
