import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  createRemoteContainer as createRemoteContainerMutation,
  moveRemoteContainer as moveRemoteContainerMutation,
  readContainerMutationMetadataDocumentId,
  referencedPrincipalHeadsFromContainerMutationResponse,
  shareRemoteContainer as shareRemoteContainerMutation,
  shareRemoteContainerWithGroup as shareRemoteContainerWithGroupMutation,
} from "../../containers";
import {
  createRemoteDocument,
  resolveDocumentCreateAuthor,
} from "../../documents";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import {
  CONTAINER_ALREADY_COMMITTED,
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

async function createRemoteContainerWithSeparateMetadataDocument(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  containerId: string;
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<CreatedRemoteContainerState | ContainerAlreadyCommitted | null> {
  const writer = resolveContainerWriterContext(
    input.runtime,
    "container create",
  );
  if (!writer) {
    return null;
  }
  const { apiClient, author, execSql, secretKey: parentSecretKey } = writer;
  const parentProjection =
    input.parentProjection ??
    (await apiClient.getContainerWriterProjection(input.parentContainerId));
  if (!parentProjection) {
    return null;
  }

  const createdContainer = await createRemoteContainerMutation({
    apiClient,
    author,
    containerId: input.containerId,
    execSql,
    metadataDocumentId: input.containerId,
    parentContainerId: input.parentContainerId,
    parentProjection,
    parentSecretKey,
    reportSecurityIncident: input.runtime.util.reportSecurityIncident,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  if (!createdContainer && input.stillCurrent?.() === false) {
    return null;
  }
  if (!createdContainer) {
    const existingProjection = await apiClient.getContainerWriterProjection(
      input.containerId,
    );
    if (!existingProjection) return null;
    const existingState = readContainerState(
      getTargetContainerContext(existingProjection).manifest,
    );
    if (
      existingProjection.containerId !== input.containerId ||
      existingProjection.organizationId !== parentProjection.organizationId ||
      existingState.containerId !== input.containerId ||
      existingState.metadataDocumentId !== input.containerId ||
      existingState.organizationId !== parentProjection.organizationId ||
      existingState.parentContainerId !== input.parentContainerId
    ) {
      throw new Error("Pending legacy container create identity mismatch");
    }
  }

  // The legacy API commits the container and its metadata document in two
  // requests. Once the container POST succeeds, finish the second phase even
  // if the caller's local generation expired: abandoning here would leave a
  // remote container that can never hydrate because its referenced metadata
  // document does not exist. The caller still discards this stale result and
  // lets the replacement generation reconcile the completed remote state.
  const createdMetadataDocument = await createRemoteDocument({
    apiClient,
    author,
    containerId: createdContainer?.containerId ?? input.containerId,
    documentId: createdContainer?.metadataDocumentId ?? input.containerId,
    execSql,
    expectedOrganizationId:
      createdContainer?.response.organizationId ??
      parentProjection.organizationId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: parentSecretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  if (!createdMetadataDocument) {
    return null;
  }
  if (!createdContainer) return CONTAINER_ALREADY_COMMITTED;

  return {
    accessManifestHash: createdContainer.response.manifestHead.manifestHash,
    systemSlot: input.systemSlot ?? null,
    containerId: createdContainer.containerId,
    createdAt: createdContainer.response.createdAt,
    metadataDocumentId: createdMetadataDocument.documentId,
    organizationId: createdContainer.response.organizationId,
    parentId: createdContainer.response.parentId,
    persistedMetadataState: createdMetadataDocument.persistedState,
    updatedAt: createdContainer.response.updatedAt,
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
  if (input.runtime.apiClient.createContainerWithMetadataDocument) {
    return createRemoteContainerWithMetadataDocument(input);
  }
  if (input.systemSlot) {
    return null;
  }

  return createRemoteContainerWithSeparateMetadataDocument(input);
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
  runtime: ContainerWorkflowRuntime;
}): Promise<{ deletedAt: string } | null> {
  const deleteResult = await input.runtime.apiClient.deleteContainerResult(
    input.containerId,
    { reportErrors: false },
  );
  if (!deleteResult.ok && deleteResult.status !== 404) {
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
