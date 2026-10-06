import type { ContainerAccessManifestState } from "@tearleads/crypto";
import {
  type ContainerSystemSlot,
  isContainerSystemSlot,
} from "@tearleads/validators/containerSystemSlot";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { locallyAcknowledgedContainerMutationHead } from "../../../data/containers/shared/mutationAcknowledgement";
import { isStaleParentContainerPathFailure } from "../../../data/containers/shared/mutationFailures";
import type { ContainerMutationSubmitFailure } from "../../../data/containers/shared/types";
import { assertDocumentWriterProjectionConsistent } from "../../../data/documents/shared/projection";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  locallyAuthoredAccessManifestHead,
} from "../../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type buildMaterializedContainerCreatePlan,
  readContainerMutationMetadataDocumentId,
} from "../../containers";
import {
  type buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
  persistedDocumentCreateStateFromResponse,
  resolveDocumentCreateAuthor,
} from "../../documents";
import { cachePrincipalPolicyBundles } from "../../principals/policyCache";
import { PrincipalPolicyRepairBudget } from "../../principals/policyRepairBudget";
import { settleTerminalCreateFailure } from "./createTerminalFailure";
import {
  buildContainerWithMetadataPlans,
  type ContainerWithMetadataPlanInput,
} from "./createWithMetadataPlan";
import type {
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
} from "./types";

/**
 * Sentinel for a lost-response retry whose manifest already exists remotely.
 * Callers avoid a duplicate; the next parent hydration settles local state.
 */
export const CONTAINER_ALREADY_COMMITTED = Symbol("containerAlreadyCommitted");
export type ContainerAlreadyCommitted = typeof CONTAINER_ALREADY_COMMITTED;

async function submitContainerWithMetadataDocument(input: {
  readonly organizationId: string;
  readonly request: ContainerCreateWithMetadataDocumentRequest;
  readonly runtime: ContainerWorkflowRuntime;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly response: ContainerCreateWithMetadataDocumentResponse;
    }
  | ContainerMutationSubmitFailure
  | null
> {
  if (input.stillCurrent?.() === false) return null;
  const { apiClient } = input.runtime;
  const result = await apiClient.createContainerWithMetadataDocumentResult(
    input.request,
    {
      expectedPaymentRequiredOrganizationId: input.organizationId,
      reportErrors: false,
    },
  );
  return result.ok ? { ok: true, response: result.data } : result;
}

async function cacheStalePrincipalPolicyBundles(input: {
  readonly failure: ContainerMutationSubmitFailure;
  readonly organizationId: string;
  readonly runtime: ContainerWorkflowRuntime;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<boolean> {
  const bundles = input.failure.stalePrincipalPolicies;
  const apiClient = input.runtime.apiClient;
  const getCurrentPrincipalPolicy =
    apiClient.getCurrentPrincipalPolicy.bind(apiClient);
  if (input.stillCurrent?.() === false) return false;
  if (!bundles || bundles.length === 0) {
    return false;
  }

  // A stale-policy failure is actionable only after the supplied bundles have
  // been verified and cached; the next attempt will rebuild from that cache.
  await cachePrincipalPolicyBundles({
    bundles,
    execSql: input.runtime.infra.execSql,
    getCurrentPrincipalPolicy,
    log: input.runtime.util.log,
    organizationId: input.organizationId,
    reportSecurityIncident: input.runtime.util.reportSecurityIncident,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    stillCurrent: input.stillCurrent,
  });
  return input.stillCurrent?.() !== false;
}

/**
 * Seed the metadata document's writer projection from the create response so the
 * first read after the container is created (its own metadata sync, contents
 * hydration) resolves locally instead of a cold `GET writer-projection`. The
 * authorizing path is the child container projection the create was authored
 * against — locally built rather than server-fetched, so unlike the plain
 * document-create path this is gated on the projection's internal consistency;
 * on any mismatch the seed is skipped and the next read falls back to a fetch.
 */
async function seedMetadataDocumentWriterProjection(input: {
  readonly runtime: ContainerWorkflowRuntime;
  readonly childProjection: ContainerWriterProjectionResponse;
  readonly response: ContainerCreateWithMetadataDocumentResponse;
  readonly execSql?: ExecSql | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  const projection = documentWriterProjectionFromCreateResponse({
    containerProjection: input.childProjection,
    response: input.response.metadataDocument,
  });
  try {
    await assertDocumentWriterProjectionConsistent(projection, {
      execSql: input.execSql,
      stillCurrent: input.stillCurrent,
      trustedLocalProjection: true,
    });
  } catch {
    return;
  }
  if (input.stillCurrent?.() === false) return;
  input.runtime.apiClient.primeDocumentWriterProjection(
    input.response.metadataDocument.id,
    projection,
  );
}

async function acknowledgeContainerWithMetadata(input: {
  containerPlan: Parameters<
    typeof locallyAcknowledgedContainerMutationHead
  >[0]["plan"];
  execSql: ExecSql;
  metadataDocumentPlan: Parameters<
    typeof persistedDocumentCreateStateFromResponse
  >[0];
  response: ContainerCreateWithMetadataDocumentResponse;
  stillCurrent?: (() => boolean) | undefined;
}) {
  const persistedState = persistedDocumentCreateStateFromResponse(
    input.metadataDocumentPlan,
    input.response.metadataDocument,
  );
  const containerHead = await locallyAcknowledgedContainerMutationHead({
    plan: input.containerPlan,
    response: input.response.container,
  });
  await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    execSql: input.execSql,
    heads: [
      containerHead,
      locallyAuthoredAccessManifestHead(input.metadataDocumentPlan),
    ],
    stillCurrent: input.stillCurrent,
  });
  return persistedState;
}

/**
 * Prime the new container's writer projection from the create plan the client
 * just authored, so the first write under it (a child folder, a document)
 * resolves locally instead of a cold `GET writer-projection`. Only primed when
 * the locally-built projection matches what the server created — the create
 * response echoes the container id and manifest head — so a mismatch skips the
 * seed and the next write falls back to a fetch (same fail-closed contract as
 * the metadata-document seed). Priming is safe for writes: the server still
 * validates every mutation, so a projection that later goes stale (rekey/share/
 * move evict it) just yields a rejected write that retries with a fresh fetch.
 */
function seedChildContainerWriterProjection(input: {
  readonly childProjection: ContainerWriterProjectionResponse;
  readonly response: ContainerCreateWithMetadataDocumentResponse;
  readonly runtime: ContainerWorkflowRuntime;
}): void {
  const createdManifestHash =
    input.response.container.manifestHead.manifestHash;
  const projectedManifestHash = input.childProjection.path.at(-1)?.manifestHash;
  // Both hashes must be present and equal, or two undefined hashes would compare
  // equal and prime an empty/invalid projection.
  if (
    !createdManifestHash ||
    !projectedManifestHash ||
    input.childProjection.containerId !==
      input.response.container.containerId ||
    projectedManifestHash !== createdManifestHash
  ) {
    return;
  }

  input.runtime.apiClient.primeContainerWriterProjection(
    input.response.container.containerId,
    input.childProjection,
  );
}

/**
 * The persisted slot is the one this client signed into the manifest state.
 * The acknowledgement already refused a response that echoed anything else,
 * so the server's column never chooses which local record becomes Trash.
 */
function signedCreateSystemSlot(
  state: ContainerAccessManifestState,
): ContainerSystemSlot | null {
  if (state.systemSlot === null) return null;
  if (!isContainerSystemSlot(state.systemSlot)) {
    throw new Error("Container create plan signed an invalid system slot");
  }
  return state.systemSlot;
}

async function settleContainerWithMetadataCreate(input: {
  readonly childProjection: ContainerWriterProjectionResponse;
  readonly containerPlan: Awaited<
    ReturnType<typeof buildMaterializedContainerCreatePlan>
  >;
  readonly execSql: ExecSql;
  readonly metadataDocumentPlan: Awaited<
    ReturnType<typeof buildMaterializedDocumentCreatePlan>
  >;
  readonly response: ContainerCreateWithMetadataDocumentResponse;
  readonly runtime: ContainerWorkflowRuntime;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<{
  readonly ok: true;
  readonly state: CreatedRemoteContainerState;
} | null> {
  if (
    input.response.container.containerId !==
    input.containerPlan.plan.containerId
  ) {
    throw new Error("Container metadata create response container mismatch");
  }
  // The acknowledgement echoed the signed parent, which a child always names.
  const parentId = input.containerPlan.plan.state.parentContainerId;
  if (parentId === null) {
    throw new Error("A container create must commit under a parent");
  }
  const metadataDocumentId = readContainerMutationMetadataDocumentId({
    response: input.response.container,
  });
  if (
    metadataDocumentId !== input.containerPlan.plan.metadataDocumentId ||
    input.response.metadataDocument.id !==
      input.metadataDocumentPlan.plan.documentId
  ) {
    throw new Error("Container metadata create response document mismatch");
  }
  const persistedMetadataState = await acknowledgeContainerWithMetadata({
    containerPlan: input.containerPlan.plan,
    execSql: input.execSql,
    metadataDocumentPlan: input.metadataDocumentPlan.plan,
    response: input.response,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;
  await seedMetadataDocumentWriterProjection({
    childProjection: input.childProjection,
    execSql: input.execSql,
    response: input.response,
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;
  seedChildContainerWriterProjection({
    childProjection: input.childProjection,
    response: input.response,
    runtime: input.runtime,
  });
  return {
    ok: true,
    state: {
      accessManifestHash: input.response.container.manifestHead.manifestHash,
      systemSlot: signedCreateSystemSlot(input.containerPlan.plan.state),
      containerId: input.response.container.containerId,
      createdAt: input.response.container.createdAt,
      metadataDocumentId,
      organizationId: input.response.container.organizationId,
      parentId,
      persistedMetadataState,
      updatedAt: input.response.container.updatedAt,
    },
  };
}

async function createRemoteContainerWithMetadataDocumentAttempt(
  input: ContainerWithMetadataPlanInput,
): Promise<
  | {
      readonly ok: true;
      readonly state: CreatedRemoteContainerState;
    }
  | ContainerMutationSubmitFailure
  | null
> {
  const execSql = input.runtime.infra.execSql;
  const plans = await buildContainerWithMetadataPlans(input);
  if (!plans) return null;
  const { containerPlan, childProjection, metadataDocumentPlan } = plans;
  const submitted = await submitContainerWithMetadataDocument({
    organizationId: containerPlan.plan.state.organizationId,
    request: {
      systemSlot: input.systemSlot ?? null,
      container: containerPlan.plan.request,
      metadataDocument: metadataDocumentPlan.plan.request,
    },
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
  });
  if (!submitted?.ok) {
    return submitted;
  }
  return settleContainerWithMetadataCreate({
    childProjection,
    containerPlan,
    execSql,
    metadataDocumentPlan,
    response: submitted.response,
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
  });
}

async function createContainerWithMetadataWithRepairs(
  input: Parameters<
    typeof createRemoteContainerWithMetadataDocumentAttempt
  >[0] & {
    readonly parentContainerId: string;
  },
): Promise<CreatedRemoteContainerState | ContainerAlreadyCommitted | null> {
  const { apiClient } = input.runtime;
  let parentProjection = input.parentProjection;
  let didRepairStaleParent = false;
  const policyRepairs = new PrincipalPolicyRepairBudget();
  for (;;) {
    const submitted = await createRemoteContainerWithMetadataDocumentAttempt({
      ...input,
      parentProjection,
    });
    if (!submitted) {
      return null;
    }
    if (submitted.ok) {
      return submitted.state;
    }
    if (
      policyRepairs.take(submitted.stalePrincipalPolicies) &&
      (await cacheStalePrincipalPolicyBundles({
        failure: submitted,
        organizationId: parentProjection.organizationId,
        runtime: input.runtime,
        stillCurrent: input.stillCurrent,
      }))
    ) {
      continue;
    }
    if (
      !didRepairStaleParent &&
      isStaleParentContainerPathFailure(submitted) &&
      apiClient.evictContainerWriterProjection &&
      input.stillCurrent?.() !== false
    ) {
      didRepairStaleParent = true;
      apiClient.evictContainerWriterProjection(input.parentContainerId);
      const refreshedProjection = await apiClient.getContainerWriterProjection(
        input.parentContainerId,
      );
      if (!refreshedProjection) {
        return null;
      }
      if (input.stillCurrent?.() === false) return null;
      parentProjection = refreshedProjection;
      continue;
    }
    return settleTerminalCreateFailure(submitted, input.stillCurrent) ===
      "committed"
      ? CONTAINER_ALREADY_COMMITTED
      : null;
  }
}

export async function createRemoteContainerWithMetadataDocument(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  containerId: string;
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<CreatedRemoteContainerState | ContainerAlreadyCommitted | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const parentSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !parentSecretKey) {
    input.runtime.util.log(
      "Container contents: skipped container create because the writer context is unavailable.",
    );
    return null;
  }

  const parentProjection =
    input.parentProjection ??
    (await apiClient.getContainerWriterProjection(input.parentContainerId));
  if (!parentProjection) {
    return null;
  }

  const containerEventId = crypto.randomUUID();
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerSignedAt = new Date().toISOString();
  const metadataContentKey = crypto.getRandomValues(new Uint8Array(32));
  const metadataEventId = crypto.randomUUID();
  const metadataSignedAt = new Date().toISOString();
  return createContainerWithMetadataWithRepairs({
    author,
    containerEventId,
    containerId: input.containerId,
    containerKey,
    containerSignedAt,
    metadataContentKey,
    metadataEventId,
    metadataSignedAt,
    parentContainerId: input.parentContainerId,
    parentProjection,
    parentSecretKey,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
    systemSlot: input.systemSlot,
  });
}
