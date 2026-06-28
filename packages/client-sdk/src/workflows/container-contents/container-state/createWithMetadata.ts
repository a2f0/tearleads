import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ContainerMutationSubmitFailure } from "../../../data/containers/shared/types";
import { assertDocumentWriterProjectionConsistent } from "../../../data/documents/shared/projection";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
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
import { createReferencedPrincipalPolicyWarmer } from "../../principals/referencedPrincipalPolicyWarmer";
import type {
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
} from "./types";

// Build an on-demand principal-policy warmer for the create when the API can
// serve current policies. The warmer fetches the parent path's referenced
// policies (e.g. the granting group's) so a member writing under another org's
// shared root can build the create plan without a pre-warmed cache. Returns
// undefined when the API lacks the capability, leaving behavior unchanged.
function buildContainerCreatePolicyWarmer(input: {
  runtime: ContainerWorkflowRuntime;
  organizationId: string;
}) {
  const getCurrentPrincipalPolicy =
    input.runtime.apiClient.getCurrentPrincipalPolicy;
  if (!getCurrentPrincipalPolicy) {
    return undefined;
  }

  return createReferencedPrincipalPolicyWarmer({
    execSql: input.runtime.infra.execSql,
    getCurrentPrincipalPolicy: (principalType, principalId) =>
      getCurrentPrincipalPolicy(principalType, principalId),
    getEncapsulationKey: input.runtime.getEncapsulationKey,
    log: input.runtime.util.log,
    organizationId: input.organizationId,
  });
}

async function submitContainerWithMetadataDocument(input: {
  readonly request: ContainerCreateWithMetadataDocumentRequest;
  readonly runtime: ContainerWorkflowRuntime;
}): Promise<
  | {
      readonly ok: true;
      readonly response: ContainerCreateWithMetadataDocumentResponse;
    }
  | ContainerMutationSubmitFailure
  | null
> {
  const { apiClient } = input.runtime;
  if (apiClient.createContainerWithMetadataDocumentResult) {
    const result = await apiClient.createContainerWithMetadataDocumentResult(
      input.request,
      { reportErrors: false },
    );

    return result.ok ? { ok: true, response: result.data } : result;
  }

  const createWithMetadata = apiClient.createContainerWithMetadataDocument;
  if (!createWithMetadata) {
    return null;
  }

  const response = await createWithMetadata(input.request);
  return response ? { ok: true, response } : null;
}

async function cacheStalePrincipalPolicyBundles(input: {
  readonly failure: ContainerMutationSubmitFailure;
  readonly runtime: ContainerWorkflowRuntime;
}): Promise<boolean> {
  const bundles = input.failure.stalePrincipalPolicies;
  const getCurrentPrincipalPolicy =
    input.runtime.apiClient.getCurrentPrincipalPolicy;
  if (!bundles || bundles.length === 0 || !getCurrentPrincipalPolicy) {
    return false;
  }

  // A stale-policy failure is actionable only after the supplied bundles have
  // been verified and cached; the next attempt will rebuild from that cache.
  await cachePrincipalPolicyBundles({
    bundles,
    execSql: input.runtime.infra.execSql,
    getCurrentPrincipalPolicy,
    getEncapsulationKey: input.runtime.getEncapsulationKey,
    log: input.runtime.util.log,
    organizationId: input.runtime.auth.organizationId,
  });
  return true;
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
}): Promise<void> {
  const projection = documentWriterProjectionFromCreateResponse({
    containerProjection: input.childProjection,
    response: input.response.metadataDocument,
  });
  try {
    await assertDocumentWriterProjectionConsistent(projection, {
      execSql: input.execSql,
      trustedLocalProjection: true,
    });
  } catch {
    return;
  }
  input.runtime.apiClient.primeDocumentWriterProjection(
    input.response.metadataDocument.id,
    projection,
  );
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
    input.response.container.manifestHead?.manifestHash;
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

async function createRemoteContainerWithMetadataDocumentAttempt(input: {
  readonly author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  readonly containerId: string;
  readonly parentProjection: ContainerWriterProjectionResponse;
  readonly parentSecretKey: Uint8Array;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly runtime: ContainerWorkflowRuntime;
  readonly systemSlot?: ContainerSystemSlot | null | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly state: CreatedRemoteContainerState;
    }
  | ContainerMutationSubmitFailure
  | null
> {
  const execSql = input.runtime.infra.execSql;
  // Build both signed mutations in one attempt so a retry can regenerate every
  // hash and key wrap from the refreshed principal-policy cache.
  const containerPlan = await buildMaterializedContainerCreatePlan({
    author: input.author,
    containerId: input.containerId,
    execSql,
    metadataDocumentId: input.containerId,
    parentProjection: input.parentProjection,
    parentSecretKey: input.parentSecretKey,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: buildContainerCreatePolicyWarmer({
      organizationId: input.parentProjection.organizationId,
      runtime: input.runtime,
    }),
  });
  const childProjection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan: containerPlan,
    parentProjection: input.parentProjection,
  });
  const metadataDocumentPlan = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection: childProjection,
    documentId: containerPlan.plan.metadataDocumentId,
    execSql,
    knownContainerKeks: new Map([
      [containerPlan.plan.containerKeyEpochId, containerPlan.containerKey],
    ]),
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
  });
  if (!submitted || !submitted.ok) {
    return submitted;
  }

  const response = submitted.response;
  if (response.container.containerId !== containerPlan.plan.containerId) {
    throw new Error("Container metadata create response container mismatch");
  }
  const metadataDocumentId = readContainerMutationMetadataDocumentId({
    response: response.container,
  });
  if (
    metadataDocumentId !== containerPlan.plan.metadataDocumentId ||
    response.metadataDocument.id !== metadataDocumentPlan.plan.documentId
  ) {
    throw new Error("Container metadata create response document mismatch");
  }

  await seedMetadataDocumentWriterProjection({
    childProjection,
    execSql,
    response,
    runtime: input.runtime,
  });
  seedChildContainerWriterProjection({
    childProjection,
    response,
    runtime: input.runtime,
  });

  return {
    ok: true,
    state: {
      accessManifestHash: response.container.manifestHead.manifestHash,
      systemSlot: response.container.systemSlot ?? input.systemSlot ?? null,
      containerId: response.container.containerId,
      createdAt: response.container.createdAt,
      metadataDocumentId,
      organizationId: response.container.organizationId,
      parentId: response.container.parentId,
      persistedMetadataState: persistedDocumentCreateStateFromResponse(
        metadataDocumentPlan.plan,
        response.metadataDocument,
      ),
      updatedAt: response.container.updatedAt,
    },
  };
}

export async function createRemoteContainerWithMetadataDocument(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  containerId: string;
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<CreatedRemoteContainerState | null> {
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

  const maxAttempts = apiClient.createContainerWithMetadataDocumentResult
    ? 2
    : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const submitted = await createRemoteContainerWithMetadataDocumentAttempt({
      author,
      containerId: input.containerId,
      parentProjection,
      parentSecretKey,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      runtime: input.runtime,
      systemSlot: input.systemSlot,
    });
    if (!submitted) {
      return null;
    }

    if (!submitted.ok) {
      if (
        attempt < maxAttempts &&
        (await cacheStalePrincipalPolicyBundles({
          failure: submitted,
          runtime: input.runtime,
        }))
      ) {
        // The original body is signed over stale policy material, so retry by
        // rebuilding the mutation instead of replaying the rejected request.
        continue;
      }

      submitted.report();
      return null;
    }

    return submitted.state;
  }

  return null;
}
