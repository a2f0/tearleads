import type { ApiClient } from "@tearleads/api-client";
import {
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type { DocumentPlacementCleanup } from "../../data/persistence/documents/documentsPersistence";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import { BlobAttachmentService } from "../blobs/blobAttachmentService";
import { PrincipalPolicyService } from "../principals/principalPolicyService";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../shared/runtimeInput";

interface DocumentsWorkflowRuntimeUtilInput
  extends Omit<WorkflowRuntimeUtilInput, "logError"> {
  /** A read-only history replay leaves pending attachment detaches to writable devices. */
  readonly deferAttachmentDetaches?: boolean;
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
  /** Private host custody, held by the runtime's policy service and never exposed on runtime views. */
  readonly withPrincipalHistoryProtection?:
    | PrincipalHistoryProtectionLease
    | undefined;
  readonly apiClient: ApiClient;
  readonly deleteDocumentPlacements: DocumentPlacementCleanup;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

/** A runtime snapshot whose producer already bound its policy service, such as `workflowInput()`. */
export interface DocumentsWorkflowRuntimeSnapshot
  extends DocumentsWorkflowRuntimeInputGroups {
  readonly apiClient: ApiClient;
  readonly deleteDocumentPlacements: DocumentPlacementCleanup;
  readonly principalPolicies: PrincipalPolicyService;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface DocumentsWorkflowRuntime
  extends DocumentsWorkflowRuntimeGroups {
  readonly apiClient: ApiClient;
  /** Bound to this snapshot's API client, executor, and key material. */
  readonly blobAttachments: BlobAttachmentService;
  /** Container Contents' placement cleanup, bound by the composition root. */
  readonly deleteDocumentPlacements: DocumentPlacementCleanup;
  /** Bound to this snapshot's API client, executor, and history custody. */
  readonly principalPolicies: PrincipalPolicyService;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

/** Standalone hosts supply their own lease; the view never carries it. */
export function createDocumentsWorkflowRuntime(
  input: DocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntime {
  return createDocumentsWorkflowRuntimeFromSnapshot({
    ...input,
    principalPolicies: new PrincipalPolicyService(input),
  });
}

export function createDocumentsWorkflowRuntimeFromSnapshot(
  snapshot: DocumentsWorkflowRuntimeSnapshot,
): DocumentsWorkflowRuntime {
  const documentProjectors = resolveDocumentProjectorRegistry(
    snapshot.infra.documentProjectors,
  );
  const infra = {
    ...snapshot.infra,
    documentProjectors,
  };

  return {
    apiClient: snapshot.apiClient,
    blobAttachments: new BlobAttachmentService({
      api: snapshot.apiClient,
      encapsulationSecretKey:
        snapshot.crypto.encapsulationKeyPair?.secretKey ?? null,
      execSql: snapshot.infra.execSql,
      log: snapshot.util.log,
      reportSecurityIncident: snapshot.util.reportSecurityIncident,
    }),
    auth: snapshot.auth,
    crypto: snapshot.crypto,
    deleteDocumentPlacements: snapshot.deleteDocumentPlacements,
    infra,
    principalPolicies: snapshot.principalPolicies,
    resolveTrustedUserIdentity: requireTrustedUserIdentityResolver(
      snapshot.resolveTrustedUserIdentity,
    ),
    state: snapshot.state,
    util: snapshot.util,
  };
}
