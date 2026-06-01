import { base64ToBytes } from "@tearleads/encoding";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
  createRemoteContainer as createRemoteContainerMutation,
  moveRemoteContainer as moveRemoteContainerMutation,
  readContainerMutationMetadataDocumentId,
  referencedPrincipalHeadsFromContainerMutationResponse,
  shareRemoteContainer as shareRemoteContainerMutation,
  shareRemoteContainerWithGroup as shareRemoteContainerWithGroupMutation,
} from "../../containers";
import {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  persistedDocumentCreateStateFromResponse,
  resolveDocumentCreateAuthor,
} from "../../documents";
import type {
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
  RemoteContainer,
  SharedRemoteContainerState,
} from "./types";

async function createRemoteContainerWithMetadataDocument(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  containerId: string;
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<CreatedRemoteContainerState | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const execSql = input.runtime.infra.execSql;
  const parentSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !parentSecretKey) {
    input.runtime.util.log(
      "Container contents: skipped container create because the writer context is unavailable.",
    );
    return null;
  }

  if (!apiClient.createContainerWithMetadataDocument) {
    return null;
  }

  const parentProjection =
    input.parentProjection ??
    (await apiClient.getContainerWriterProjection(input.parentContainerId));
  if (!parentProjection) {
    return null;
  }

  const containerPlan = await buildMaterializedContainerCreatePlan({
    author,
    containerId: input.containerId,
    execSql,
    metadataDocumentId: input.containerId,
    parentProjection,
    parentSecretKey,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
  const childProjection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan: containerPlan,
    parentProjection,
  });
  const metadataDocumentPlan = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: childProjection,
    documentId: containerPlan.plan.metadataDocumentId,
    execSql,
    knownContainerKeks: new Map([
      [containerPlan.plan.containerKeyEpochId, containerPlan.containerKey],
    ]),
    targetSecretKey: parentSecretKey,
    trustedLocalProjection: true,
  });
  const response = await apiClient.createContainerWithMetadataDocument({
    systemSlot: input.systemSlot ?? null,
    container: containerPlan.plan.request,
    metadataDocument: metadataDocumentPlan.plan.request,
  });
  if (!response) {
    return null;
  }
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
  };
}

async function createRemoteContainerWithSeparateMetadataDocument(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  containerId: string;
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<CreatedRemoteContainerState | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const execSql = input.runtime.infra.execSql;
  const parentSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !parentSecretKey) {
    input.runtime.util.log(
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
    parentProjection: input.parentProjection,
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
}): Promise<CreatedRemoteContainerState | null> {
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

export async function shareRemoteContainer(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  previousProjection: ContainerWriterProjectionResponse;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedRemoteContainerState | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const execSql = input.runtime.infra.execSql;
  const targetSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.util.log(
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
    previousProjection: input.previousProjection,
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
    writerProjection: containerWriterProjectionFromMutationResponse({
      previousProjection: input.previousProjection,
      response: shared.response,
    }),
  };
}

export async function shareRemoteContainerWithGroup(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  previousProjection: ContainerWriterProjectionResponse;
  recipientGroupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedRemoteContainerState | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const execSql = input.runtime.infra.execSql;
  const targetSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.util.log(
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
    previousProjection: input.previousProjection,
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
    writerProjection: containerWriterProjectionFromMutationResponse({
      previousProjection: input.previousProjection,
      response: shared.response,
    }),
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
  const execSql = input.runtime.infra.execSql;
  const targetSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.util.log(
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
