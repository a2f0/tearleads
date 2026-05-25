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
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../runtimeInput";

type DocumentsWorkflowApi = Pick<ApiClient, keyof ApiClient>;
type DocumentsWorkflowRuntimeAuthInput = Omit<
  WorkflowRuntimeAuthInput,
  "organizationId" | "userId"
> & {
  readonly organizationId?: string | null | undefined;
  readonly userId?: string | null | undefined;
};
type DocumentsWorkflowRuntimeCryptoInput = Partial<WorkflowRuntimeCryptoInput>;
type DocumentsWorkflowRuntimeInfraInput = Omit<
  WorkflowRuntimeInfraInput,
  "dbStatus" | "documentProjectors"
> & {
  readonly dbStatus: string;
  readonly documentProjectors?: DocumentProjectorRegistryInput | undefined;
};
type DocumentsWorkflowRuntimeStateInput = Omit<
  WorkflowRuntimeStateInput,
  "containerId"
> & {
  readonly containerId?: string | null | undefined;
};
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
  readonly auth?: DocumentsWorkflowRuntimeAuthInput | undefined;
  readonly crypto?: DocumentsWorkflowRuntimeCryptoInput | undefined;
  readonly infra?: DocumentsWorkflowRuntimeInfraInput | undefined;
  readonly state?: DocumentsWorkflowRuntimeStateInput | undefined;
  readonly util?: DocumentsWorkflowRuntimeUtilInput | undefined;
}

export interface DocumentsWorkflowRuntimeInput
  extends DocumentsWorkflowRuntimeInputGroups {
  readonly apiClient: DocumentsWorkflowApi;
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly containerId?: string | null | undefined;
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

export interface DocumentsWorkflowRuntime
  extends DocumentsWorkflowRuntimeGroups,
    Omit<
      DocumentsWorkflowRuntimeInput,
      "auth" | "crypto" | "documentProjectors" | "infra" | "state" | "util"
    > {
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
    containerId: input.state?.containerId ?? input.containerId ?? null,
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
    ...input,
    auth,
    blobStore: infra.blobStore,
    cacheReferencedPrincipalPolicies: util.cacheReferencedPrincipalPolicies,
    containerId: state.containerId,
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
