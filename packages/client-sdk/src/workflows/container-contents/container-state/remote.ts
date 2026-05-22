import { base64ToBytes } from "@tearleads/encoding";
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
import { getContainerContentsWorkflowRuntimeExecSql } from "../runtime";
import type {
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
  RemoteContainer,
  SharedRemoteContainerState,
} from "./types";

export async function createRemoteContainer(input: {
  containerId: string;
  parentContainerId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<CreatedRemoteContainerState | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const execSql = getContainerContentsWorkflowRuntimeExecSql(input.runtime);
  const parentSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !parentSecretKey) {
    input.runtime.log(
      "Container contents: skipped container create because the writer context is unavailable.",
    );
    return null;
  }

  const createdContainer = await createRemoteContainerMutation({
    apiClient,
    author,
    containerId: input.containerId,
    execSql,
    metadataDocumentId: input.containerId,
    parentContainerId: input.parentContainerId,
    parentSecretKey,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
  if (!createdContainer) {
    return null;
  }

  const createdMetadataDocument = await createRemoteDocument({
    apiClient,
    author,
    containerId: createdContainer.containerId,
    documentId: createdContainer.metadataDocumentId,
    execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: parentSecretKey,
  });
  if (!createdMetadataDocument) {
    return null;
  }

  return {
    accessManifestHash: createdContainer.response.manifestHead.manifestHash,
    containerId: createdContainer.containerId,
    createdAt: createdContainer.response.createdAt,
    metadataDocumentId: createdMetadataDocument.documentId,
    organizationId: createdContainer.response.organizationId,
    parentId: createdContainer.response.parentId,
    persistedMetadataState: createdMetadataDocument.persistedState,
    updatedAt: createdContainer.response.updatedAt,
  };
}

export async function shareRemoteContainer(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedRemoteContainerState | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const execSql = getContainerContentsWorkflowRuntimeExecSql(input.runtime);
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.log(
      "Container contents: skipped container share because the writer context is unavailable.",
    );
    return null;
  }

  const recipientKey = await input.runtime.apiClient.getEncapsulationKey(
    input.recipientUserId,
  );
  if (!recipientKey) {
    return null;
  }

  const shared = await shareRemoteContainerMutation({
    accessLevel: input.accessLevel,
    apiClient,
    author,
    containerId: input.containerId,
    execSql,
    recipientEncapsulationPublicKey: base64ToBytes(
      recipientKey.encapsulationPublicKey,
    ),
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey,
  });
  if (!shared) {
    return null;
  }

  return {
    accessManifestHash: shared.response.manifestHead.manifestHash,
    accessEpoch: shared.response.manifestHead.epoch,
    createdAt: shared.response.createdAt,
    metadataDocumentId: readContainerMutationMetadataDocumentId({
      response: shared.response,
    }),
    referencedPrincipalHeads:
      referencedPrincipalHeadsFromContainerMutationResponse({
        response: shared.response,
      }),
    updatedAt: shared.response.updatedAt,
  };
}

export async function shareRemoteContainerWithGroup(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  recipientGroupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedRemoteContainerState | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const execSql = getContainerContentsWorkflowRuntimeExecSql(input.runtime);
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.log(
      "Container contents: skipped container group share because the writer context is unavailable.",
    );
    return null;
  }

  const shared = await shareRemoteContainerWithGroupMutation({
    accessLevel: input.accessLevel,
    apiClient,
    author,
    containerId: input.containerId,
    execSql,
    recipientGroupId: input.recipientGroupId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey,
  });
  if (!shared) {
    return null;
  }

  return {
    accessManifestHash: shared.response.manifestHead.manifestHash,
    accessEpoch: shared.response.manifestHead.epoch,
    createdAt: shared.response.createdAt,
    metadataDocumentId: readContainerMutationMetadataDocumentId({
      response: shared.response,
    }),
    referencedPrincipalHeads:
      referencedPrincipalHeadsFromContainerMutationResponse({
        response: shared.response,
      }),
    updatedAt: shared.response.updatedAt,
  };
}

export async function moveRemoteContainer(input: {
  containerId: string;
  parentContainerId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<RemoteContainer | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const execSql = getContainerContentsWorkflowRuntimeExecSql(input.runtime);
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.log(
      "Container contents: skipped container move because the writer context is unavailable.",
    );
    return null;
  }

  const moved = await moveRemoteContainerMutation({
    apiClient,
    author,
    containerId: input.containerId,
    destinationParentContainerId: input.parentContainerId,
    execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey,
  });
  if (!moved) {
    return null;
  }

  return {
    createdAt: moved.response.createdAt,
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
}): Promise<boolean> {
  const deleteResult = await input.runtime.apiClient.deleteContainerResult(
    input.containerId,
    { reportErrors: false },
  );
  if (!deleteResult.ok && deleteResult.status !== 404) {
    deleteResult.report();
    return false;
  }

  return true;
}
