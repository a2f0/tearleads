import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ContainerMutationSubmitFailure } from "../../../data/containers/shared/types";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
  readContainerMutationMetadataDocumentId,
} from "../../containers";
import {
  buildMaterializedDocumentCreatePlan,
  persistedDocumentCreateStateFromResponse,
  resolveDocumentCreateAuthor,
} from "../../documents";
import { cachePrincipalPolicyBundles } from "../../principals/policyCache";
import type {
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
} from "./types";

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
