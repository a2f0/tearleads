import type { ApiClient } from "@tearleads/api-client";
import {
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import { inheritPrincipalHistoryProtection } from "../../data/principals/principalHistoryRuntime";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import { BlobAttachmentService } from "../blobs/blobAttachmentService";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../shared/runtimeInput";

interface DocumentsWorkflowRuntimeUtilInput
  extends Omit<WorkflowRuntimeUtilInput, "logError"> {
  /** Receives handled quarantine errors without converting them to strings. */
  readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
}

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
  /** Private host custody, inherited without exposing it on runtime views. */
  readonly withPrincipalHistoryProtection?:
    | PrincipalHistoryProtectionLease
    | undefined;
  readonly apiClient: ApiClient;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface DocumentsWorkflowRuntime
  extends DocumentsWorkflowRuntimeGroups {
  readonly apiClient: ApiClient;
  /** Bound to this snapshot's API client, executor, and key material. */
  readonly blobAttachments: BlobAttachmentService;
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

  return inheritPrincipalHistoryProtection(input, {
    apiClient: input.apiClient,
    blobAttachments: new BlobAttachmentService({
      api: input.apiClient,
      encapsulationSecretKey:
        input.crypto.encapsulationKeyPair?.secretKey ?? null,
      execSql: input.infra.execSql,
      log: input.util.log,
      reportSecurityIncident: input.util.reportSecurityIncident,
    }),
    auth: input.auth,
    crypto: input.crypto,
    infra,
    resolveTrustedUserIdentity: requireTrustedUserIdentityResolver(
      input.resolveTrustedUserIdentity,
    ),
    state: input.state,
    util: input.util,
  });
}
