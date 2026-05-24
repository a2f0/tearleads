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
  readonly apiClient: DocumentsWorkflowApi;
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly containerId?: string | null | undefined;
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

export interface DocumentsWorkflowRuntime
  extends Omit<DocumentsWorkflowRuntimeInput, "documentProjectors"> {
  readonly documentProjectors: DocumentProjectorRegistry;
  readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  readonly organizationId: string | null;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: SigningKeyPair | null;
  readonly userId: string | null;
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
