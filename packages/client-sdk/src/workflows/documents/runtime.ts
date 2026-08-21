import type { ApiClient } from "@symcrypt/api-client";
import {
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../runtimeInput";

type DocumentsWorkflowRuntimeUtilInput = Omit<
  WorkflowRuntimeUtilInput,
  "logError"
>;

export interface DocumentsWorkflowRuntimeInfra
  extends Omit<WorkflowRuntimeInfraInput, "dbStatus"> {
  readonly dbStatus: string;
}

interface DocumentsWorkflowRuntimeInputInfra
  extends Omit<DocumentsWorkflowRuntimeInfra, "documentProjectors"> {
  readonly documentProjectors: DocumentProjectorRegistryInput;
}

export interface DocumentsWorkflowRuntimeGroups {
  readonly auth: WorkflowRuntimeAuthInput;
  readonly crypto: WorkflowRuntimeCryptoInput;
  readonly infra: DocumentsWorkflowRuntimeInfra;
  readonly state: WorkflowRuntimeStateInput;
  readonly util: DocumentsWorkflowRuntimeUtilInput;
}

export interface DocumentsWorkflowRuntimeInputGroups {
  readonly auth: WorkflowRuntimeAuthInput;
  readonly crypto: WorkflowRuntimeCryptoInput;
  readonly infra: DocumentsWorkflowRuntimeInputInfra;
  readonly state: WorkflowRuntimeStateInput;
  readonly util: DocumentsWorkflowRuntimeUtilInput;
}

export interface DocumentsWorkflowRuntimeInput
  extends DocumentsWorkflowRuntimeInputGroups {
  readonly apiClient: ApiClient;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface DocumentsWorkflowRuntime
  extends DocumentsWorkflowRuntimeGroups {
  readonly apiClient: ApiClient;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
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
    resolveTrustedUserIdentity: requireTrustedUserIdentityResolver(
      input.resolveTrustedUserIdentity,
    ),
    state: input.state,
    util: input.util,
  };
}
