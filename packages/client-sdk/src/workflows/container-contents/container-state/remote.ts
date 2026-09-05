import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { isContainerNotFoundFailure } from "../../../data/containers/shared/mutationFailures";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  moveRemoteContainer as moveRemoteContainerMutation,
  readContainerMutationMetadataDocumentId,
  referencedPrincipalHeadsFromContainerMutationResponse,
  shareRemoteContainer as shareRemoteContainerMutation,
  shareRemoteContainerWithGroup as shareRemoteContainerWithGroupMutation,
} from "../../containers";
import { resolveDocumentCreateAuthor } from "../../documents";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import {
  type ContainerAlreadyCommitted,
  createRemoteContainerWithMetadataDocument,
} from "./createWithMetadata";
import type {
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
  RemoteContainer,
  SharedRemoteContainerState,
} from "./types";

/**
 * Resolve the author, api client, executor, and encapsulation secret a remote
 * container mutation needs, logging a skip for the given operation when the
 * writer context is unavailable.
 */
function resolveContainerWriterContext(
  runtime: ContainerWorkflowRuntime,
  operation:
    | "container create"
    | "container group share"
    | "container move"
    | "container share",
) {
  const author = resolveDocumentCreateAuthor(runtime);
  const secretKey = runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !secretKey) {
    runtime.util.log(
      `Container contents: skipped ${operation} because the writer context is unavailable.`,
    );
    return null;
  }

  return {
    apiClient: runtime.apiClient,
    author,
    execSql: runtime.infra.execSql,
    secretKey,
  };
}

export async function createRemoteContainer(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  containerId: string;
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<CreatedRemoteContainerState | ContainerAlreadyCommitted | null> {
  return createRemoteContainerWithMetadataDocument(input);
}

function containerWriterProjectionFromMutationResponse(input: {
  previousProjection: ContainerWriterProjectionResponse;
  response: ContainerMutationResponse;
}): ContainerWriterProjectionResponse {
  if (input.response.containerId !== input.previousProjection.containerId) {
    throw new Error("Container mutation response projection mismatch");
  }

  return {
    containerId: input.response.containerId,
    organizationId: input.response.organizationId,
    path: [
      ...input.previousProjection.path.slice(0, -1),
      input.response.accessManifest,
    ],
    containerKeks: [
      ...input.previousProjection.containerKeks.slice(0, -1),
      input.response.containerKek,
    ],
  };
}

function sharedRemoteContainerStateFromMutation(
  previousProjection: ContainerWriterProjectionResponse,
  response: ContainerMutationResponse,
): SharedRemoteContainerState {
  return {
    accessManifestHash: response.manifestHead.manifestHash,
    accessEpoch: response.manifestHead.epoch,
    createdAt: response.createdAt,
    metadataDocumentId: readContainerMutationMetadataDocumentId({ response }),
    referencedPrincipalHeads:
      referencedPrincipalHeadsFromContainerMutationResponse({ response }),
    updatedAt: response.updatedAt,
    writerProjection: containerWriterProjectionFromMutationResponse({
      previousProjection,
      response,
    }),
  };
}

export async function shareRemoteContainer(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  previousProjection: ContainerWriterProjectionResponse;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<SharedRemoteContainerState | null> {
  const writer = resolveContainerWriterContext(
    input.runtime,
    "container share",
  );
  if (!writer) {
    return null;
  }
  const { apiClient, author, execSql, secretKey: targetSecretKey } = writer;

  const shared = await shareRemoteContainerMutation({
    accessLevel: input.accessLevel,
    apiClient,
    author,
    containerId: input.containerId,
    execSql,
    previousProjection: input.previousProjection,
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    stillCurrent: input.stillCurrent,
    targetSecretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  if (!shared) {
    return null;
  }

  return sharedRemoteContainerStateFromMutation(
    input.previousProjection,
    shared.response,
  );
}

export async function shareRemoteContainerWithGroup(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  expectedGroupName?: string | undefined;
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  recipientGroupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<SharedRemoteContainerState | null> {
  const writer = resolveContainerWriterContext(
    input.runtime,
    "container group share",
  );
  if (!writer) {
    return null;
  }
  const { apiClient, author, execSql, secretKey: targetSecretKey } = writer;

  const shared = await shareRemoteContainerWithGroupMutation({
    accessLevel: input.accessLevel,
    apiClient,
    author,
    containerId: input.containerId,
    execSql,
    expectedGroupName: input.expectedGroupName ?? null,
    knownContainerKeks: input.knownContainerKeks,
    previousProjection: input.previousProjection,
    recipientGroupId: input.recipientGroupId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    signingKeyPair: input.runtime.crypto.signingKeyPair,
    stillCurrent: input.stillCurrent,
    targetSecretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  if (!shared) {
    return null;
  }

  return sharedRemoteContainerStateFromMutation(
    input.previousProjection,
    shared.response,
  );
}

export async function moveRemoteContainer(input: {
  containerId: string;
  parentContainerId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<RemoteContainer | null> {
  const writer = resolveContainerWriterContext(input.runtime, "container move");
  if (!writer) {
    return null;
  }
  const { apiClient, author, execSql, secretKey: targetSecretKey } = writer;

  const moved = await moveRemoteContainerMutation({
    apiClient,
    author,
    containerId: input.containerId,
    destinationParentContainerId: input.parentContainerId,
    execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: input.stillCurrent,
    targetSecretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  if (!moved) {
    return null;
  }

  return {
    createdAt: moved.response.createdAt,
    effectiveAccessLevel: "admin",
    id: moved.response.containerId,
    organizationId: moved.response.organizationId,
    parentId: moved.response.parentId,
    metadataDocumentId: readContainerMutationMetadataDocumentId({
      response: moved.response,
    }),
    metadataAccessEpoch: moved.response.manifestHead.epoch,
    metadataAccessStateHash: moved.response.manifestHead.manifestHash,
    metadataReferencedPrincipals:
      referencedPrincipalHeadsFromContainerMutationResponse({
        response: moved.response,
      }),
    updatedAt: moved.response.updatedAt,
  };
}

export async function deleteRemoteContainer(input: {
  containerId: string;
  organizationId: string;
  runtime: ContainerWorkflowRuntime;
}): Promise<{ deletedAt: string } | null> {
  const deleteResult = await input.runtime.apiClient.deleteContainerResult(
    input.containerId,
    {
      expectedPaymentRequiredOrganizationId: input.organizationId,
      reportErrors: false,
    },
  );
  if (!deleteResult.ok && !isContainerNotFoundFailure(deleteResult)) {
    deleteResult.report();
    return null;
  }

  if (!deleteResult.ok) {
    // A 404 proves this immutable id is permanently absent, but it does not
    // carry the server deletion time. A maximal fence prevents an older
    // in-flight listing page from resurrecting it.
    return { deletedAt: "9999-12-31T23:59:59.999Z" };
  }

  return { deletedAt: deleteResult.data.deletedAt };
}
