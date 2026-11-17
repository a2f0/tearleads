import type { ApiClient } from "@tearleads/api-client";
import type { ContainerAccessLevel } from "@tearleads/crypto";
import {
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import { deleteDocumentPlacements } from "../../data/persistence/container-contents/documentContainerProjectionPersistence";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import {
  type createDocumentsWorkflowRuntime,
  createDocumentsWorkflowRuntimeFromSnapshot,
  type DocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeSnapshot,
} from "../documents";
import { PrincipalPolicyService } from "../principals/principalPolicyService";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeInfraInput,
  WorkflowRuntimeStateInput,
  WorkflowRuntimeUtilInput,
} from "../shared/runtimeInput";

type DocumentsWorkflowRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];

type ContainerContentsWorkflowApi = ApiClient &
  DocumentsWorkflowRuntimeInput["apiClient"];

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
  extends Omit<WorkflowRuntimeUtilInput, "logError"> {
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
  /** Private host custody, held by the runtime's policy service and shared with derived document runtimes. */
  readonly withPrincipalHistoryProtection?:
    | PrincipalHistoryProtectionLease
    | undefined;
  readonly apiClient: ContainerContentsWorkflowApi;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

/** A runtime snapshot whose producer already bound its policy service, such as `workflowInput()`. */
export interface ContainerContentsWorkflowRuntimeSnapshot
  extends ContainerContentsWorkflowRuntimeInputGroups {
  readonly apiClient: ContainerContentsWorkflowApi;
  readonly principalPolicies: PrincipalPolicyService;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface ContainerContentsWorkflowRuntime
  extends ContainerContentsWorkflowRuntimeGroups,
    Pick<ContainerContentsWorkflowRuntimeInput, "apiClient"> {
  readonly adoptRootContainer?: ContainerContentsRootAdopter | undefined;
  /** Bound to this snapshot's API client, executor, and history custody. */
  readonly principalPolicies: PrincipalPolicyService;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

/**
 * Refuses a share recipient whose identity no verified identity link (or this
 * device's own keys) established. Sharing admits a user; a read share, which
 * grants no signing authority, may also rest on roster vouching.
 */
export type ContainerContentsVerifiedRecipientGuard = (
  userId: string,
  accessLevel: ContainerAccessLevel,
) => Promise<void>;

export interface ContainerContentsStoreWorkflowRuntime
  extends ContainerContentsWorkflowRuntime {
  readonly adoptRootContainer: ContainerContentsRootAdopter;
  readonly requireVerifiedRecipient: ContainerContentsVerifiedRecipientGuard;
}

export interface ContainerContentsWorkflowSqlRuntime {
  readonly auth?: {
    readonly organizationId?: string | null | undefined;
  };
  readonly infra: {
    readonly execSql: ExecSql;
  };
}

function documentsRuntimeSnapshot(
  runtime: ContainerContentsWorkflowRuntime,
  containerId: string | null,
): DocumentsWorkflowRuntimeSnapshot {
  return {
    apiClient: runtime.apiClient,
    auth: runtime.auth,
    crypto: runtime.crypto,
    deleteDocumentPlacements,
    infra: runtime.infra,
    principalPolicies: runtime.principalPolicies,
    resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
    state: { ...runtime.state, containerId },
    util: runtime.util,
  };
}

export function createContainerContentsDocumentsRuntime(
  runtime: ContainerContentsWorkflowRuntime,
  containerId: string | null,
): DocumentsWorkflowRuntime {
  return createDocumentsWorkflowRuntimeFromSnapshot(
    documentsRuntimeSnapshot(runtime, containerId),
  );
}

/** Standalone hosts supply their own lease; the view never carries it. */
function standaloneSnapshot(
  input: ContainerContentsWorkflowRuntimeInput,
): ContainerContentsWorkflowRuntimeSnapshot {
  return { ...input, principalPolicies: new PrincipalPolicyService(input) };
}

function createContainerContentsWorkflowRuntimeWithRootAdopter(
  snapshot: ContainerContentsWorkflowRuntimeSnapshot,
  adoptRootContainer?: ContainerContentsRootAdopter | undefined,
): ContainerContentsWorkflowRuntime {
  const documentProjectors = resolveDocumentProjectorRegistry(
    snapshot.infra.documentProjectors,
  );
  const infra = {
    ...snapshot.infra,
    documentProjectors,
  };

  return {
    ...(adoptRootContainer ? { adoptRootContainer } : {}),
    apiClient: snapshot.apiClient,
    auth: snapshot.auth,
    crypto: snapshot.crypto,
    infra,
    principalPolicies: snapshot.principalPolicies,
    resolveTrustedUserIdentity: requireTrustedUserIdentityResolver(
      snapshot.resolveTrustedUserIdentity,
    ),
    state: snapshot.state,
    util: snapshot.util,
  };
}

export function createContainerContentsWorkflowRuntime(
  input: ContainerContentsWorkflowRuntimeInput,
): ContainerContentsWorkflowRuntime {
  return createContainerContentsWorkflowRuntimeWithRootAdopter(
    standaloneSnapshot(input),
  );
}

export function createContainerContentsWorkflowRuntimeFromSnapshot(
  snapshot: ContainerContentsWorkflowRuntimeSnapshot,
): ContainerContentsWorkflowRuntime {
  return createContainerContentsWorkflowRuntimeWithRootAdopter(snapshot);
}

/** Internal store runtime with the session-root adoption capability wired. */
export function createContainerContentsStoreWorkflowRuntime(
  input: ContainerContentsWorkflowRuntimeInput,
  adoptRootContainer: ContainerContentsRootAdopter,
  requireVerifiedRecipient: ContainerContentsVerifiedRecipientGuard,
): ContainerContentsStoreWorkflowRuntime {
  return createContainerContentsStoreWorkflowRuntimeFromSnapshot(
    standaloneSnapshot(input),
    adoptRootContainer,
    requireVerifiedRecipient,
  );
}

export function createContainerContentsStoreWorkflowRuntimeFromSnapshot(
  snapshot: ContainerContentsWorkflowRuntimeSnapshot,
  adoptRootContainer: ContainerContentsRootAdopter,
  requireVerifiedRecipient: ContainerContentsVerifiedRecipientGuard,
): ContainerContentsStoreWorkflowRuntime {
  return {
    ...createContainerContentsWorkflowRuntimeWithRootAdopter(
      snapshot,
      adoptRootContainer,
    ),
    adoptRootContainer,
    requireVerifiedRecipient,
  };
}
