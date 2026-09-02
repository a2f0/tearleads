import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { locallyAcknowledgedContainerMutationHead } from "../../../data/containers/shared/mutationAcknowledgement";
import {
  isContainerManifestAlreadyExistsConflict,
  isStaleParentContainerPathFailure,
} from "../../../data/containers/shared/mutationFailures";
import type { ContainerMutationSubmitFailure } from "../../../data/containers/shared/types";
import { assertDocumentWriterProjectionConsistent } from "../../../data/documents/shared/projection";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  locallyAuthoredAccessManifestHead,
} from "../../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
  readContainerMutationMetadataDocumentId,
} from "../../containers";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
  persistedDocumentCreateStateFromResponse,
  resolveDocumentCreateAuthor,
} from "../../documents";
import { cachePrincipalPolicyBundles } from "../../principals/policyCache";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import type {
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
} from "./types";

/**
 * Sentinel outcome for a container-with-metadata create whose response was lost:
 * the re-submit reports that the container manifest already exists, so the
 * object is committed remotely. Callers treat this as a benign
 * idempotent-retry conflict — they neither surface it as an error nor create a
 * duplicate. The committed container's metadata state (documentId +
 * accessStateHash) lands when the parent's contents are next hydrated, which
 * marks the pending create intent synced.
 */
export const CONTAINER_ALREADY_COMMITTED = Symbol("containerAlreadyCommitted");
export type ContainerAlreadyCommitted = typeof CONTAINER_ALREADY_COMMITTED;

async function submitContainerWithMetadataDocument(input: {
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
  if (apiClient.createContainerWithMetadataDocumentResult) {
    const result = await apiClient.createContainerWithMetadataDocumentResult(
      input.request,
      { reportErrors: false },
    );

    return result.ok ? { ok: true, response: result.data } : result;
  }

  if (!apiClient.createContainerWithMetadataDocument) {
    return null;
  }

  const response = await apiClient.createContainerWithMetadataDocument(
    input.request,
  );
  return response ? { ok: true, response } : null;
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
    apiClient.getCurrentPrincipalPolicy?.bind(apiClient);
  if (input.stillCurrent?.() === false) return false;
  if (!bundles || bundles.length === 0 || !getCurrentPrincipalPolicy) {
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

function reportContainerCreateFailureIfCurrent(
  failure: ContainerMutationSubmitFailure,
  stillCurrent: (() => boolean) | undefined,
): void {
  if (stillCurrent?.() !== false) failure.report();
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
  readonly systemSlot?: ContainerSystemSlot | null | undefined;
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
      systemSlot:
        input.response.container.systemSlot ?? input.systemSlot ?? null,
      containerId: input.response.container.containerId,
      createdAt: input.response.container.createdAt,
      metadataDocumentId,
      organizationId: input.response.container.organizationId,
      parentId: input.response.container.parentId,
      persistedMetadataState,
      updatedAt: input.response.container.updatedAt,
    },
  };
}

async function createRemoteContainerWithMetadataDocumentAttempt(input: {
  readonly author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  readonly containerEventId: string;
  readonly containerId: string;
  readonly containerKey: Uint8Array;
  readonly containerSignedAt: string;
  readonly metadataContentKey: Uint8Array;
  readonly metadataEventId: string;
  readonly metadataSignedAt: string;
  readonly parentProjection: ContainerWriterProjectionResponse;
  readonly parentSecretKey: Uint8Array;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly runtime: ContainerWorkflowRuntime;
  readonly systemSlot?: ContainerSystemSlot | null | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly state: CreatedRemoteContainerState;
    }
  | ContainerMutationSubmitFailure
  | null
> {
  const execSql = input.runtime.infra.execSql;
  // Rebuild parent- and policy-dependent hashes, signatures, and wraps on every
  // attempt while retaining the logical mutation identities and key material.
  const containerPlan = await buildMaterializedContainerCreatePlan({
    author: input.author,
    containerId: input.containerId,
    containerKey: input.containerKey,
    execSql,
    eventId: input.containerEventId,
    metadataDocumentId: input.containerId,
    parentProjection: input.parentProjection,
    parentSecretKey: input.parentSecretKey,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    signedAt: input.containerSignedAt,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  const childProjection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan: containerPlan,
    parentProjection: input.parentProjection,
  });
  const metadataDocumentPlan = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection: childProjection,
    contentKey: input.metadataContentKey,
    documentId: containerPlan.plan.metadataDocumentId,
    eventId: input.metadataEventId,
    execSql,
    knownContainerKeks: new Map([
      [containerPlan.plan.containerKeyEpochId, containerPlan.containerKey],
    ]),
    signedAt: input.metadataSignedAt,
    stillCurrent: input.stillCurrent,
    targetSecretKey: input.parentSecretKey,
    trustedLocalProjection: true,
  });
  const submitted = await submitContainerWithMetadataDocument({
    request: {
      systemSlot: input.systemSlot ?? null,
      container: containerPlan.plan.request,
      metadataDocument: metadataDocumentPlan.plan.request,
    },
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
  });
  if (!submitted || !submitted.ok) {
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
    systemSlot: input.systemSlot,
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
  let didRepairStalePolicies = false;
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
      !didRepairStalePolicies &&
      (await cacheStalePrincipalPolicyBundles({
        failure: submitted,
        organizationId: parentProjection.organizationId,
        runtime: input.runtime,
        stillCurrent: input.stillCurrent,
      }))
    ) {
      didRepairStalePolicies = true;
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
    if (isContainerManifestAlreadyExistsConflict(submitted)) {
      // A create whose response was lost re-sends the same stable ids; the server
      // reports the manifest already exists. The container is committed remotely,
      // so this is the benign outcome of an idempotent retry — do not report it as
      // an error. It reconciles via hydration, matching createRemoteDocument's
      // manifest-exists handling on the document create path.
      return CONTAINER_ALREADY_COMMITTED;
    }
    reportContainerCreateFailureIfCurrent(submitted, input.stillCurrent);
    return null;
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

  if (
    !apiClient.createContainerWithMetadataDocument &&
    !apiClient.createContainerWithMetadataDocumentResult
  ) {
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
