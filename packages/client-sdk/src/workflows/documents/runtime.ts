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

type DocumentsWorkflowApi = Pick<ApiClient, keyof ApiClient>;

export interface DocumentsWorkflowRuntimeInput {
  apiClient: DocumentsWorkflowApi;
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  containerId?: string | null | undefined;
  dbStatus: string;
  documentProjectors?: DocumentProjectorRegistry | undefined;
  domainScope: DomainScope;
  encapsulationKeyPair?: EncapsulationKeyPair | null | undefined;
  events: ReadonlyArray<unknown>;
  execSql: ExecSql;
  isAuthenticated: boolean;
  log: (message: string) => void;
  online: boolean;
  organizationId?: string | null | undefined;
  signingFingerprint?: string | null | undefined;
  signingKeyPair?: SigningKeyPair | null | undefined;
  userId?: string | null | undefined;
}

export interface DocumentsWorkflowRuntime
  extends Omit<DocumentsWorkflowRuntimeInput, "documentProjectors"> {
  documentProjectors: DocumentProjectorRegistry;
  encapsulationKeyPair: EncapsulationKeyPair | null;
  organizationId: string | null;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
  userId: string | null;
}

export function createDocumentsWorkflowRuntime(
  input: DocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntime {
  return {
    ...input,
    documentProjectors:
      input.documentProjectors ?? defaultDocumentProjectorRegistry,
    encapsulationKeyPair: input.encapsulationKeyPair ?? null,
    organizationId: input.organizationId ?? null,
    signingFingerprint: input.signingFingerprint ?? null,
    signingKeyPair: input.signingKeyPair ?? null,
    userId: input.userId ?? null,
  };
}
