import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../containers";
import {
  buildMaterializedDocumentCreatePlan,
  type resolveDocumentCreateAuthor,
} from "../../documents";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import type { ContainerWorkflowRuntime } from "./types";

export interface ContainerWithMetadataPlanInput {
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
}

async function buildPlans(input: ContainerWithMetadataPlanInput) {
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
    systemSlot: input.systemSlot,
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
  return { containerPlan, childProjection, metadataDocumentPlan };
}

/** Refresh stale history evidence once, strictly before submitting the write. */
export async function buildContainerWithMetadataPlans(
  input: ContainerWithMetadataPlanInput,
) {
  try {
    return await buildPlans(input);
  } catch (error) {
    if (!(error instanceof ProjectionDependencyUnavailableError)) throw error;
  }
  if (input.stillCurrent?.() === false) return null;
  const { apiClient } = input.runtime;
  const parentId = input.parentProjection.containerId;
  apiClient.evictContainerWriterProjection(parentId);
  const parentProjection =
    await apiClient.getContainerWriterProjection(parentId);
  if (!parentProjection || input.stillCurrent?.() === false) return null;
  if (
    parentProjection.containerId !== parentId ||
    parentProjection.organizationId !== input.parentProjection.organizationId
  ) {
    throw new Error(
      "Refreshed parent projection belongs to another container or organization",
    );
  }
  return buildPlans({ ...input, parentProjection });
}
