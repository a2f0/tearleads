import type {
  ContainerWriterProjectionResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerMetadataPatch } from "../metadata";
import { persistContainerMetadataStateFromRuntime } from "../metadata";
import type { ContainerState } from "../remoteHydration";
import { loadContainerWriterProjectionForState } from "./projectionCache";
import { shareRemoteContainer, shareRemoteContainerWithGroup } from "./remote";
import type {
  ContainerWorkflowRuntime,
  SharedContainerState,
  SharedRemoteContainerState,
} from "./types";

type ContainerShareSubjectType = "group" | "user";
type ContainerShareAccessLevel = "read" | "write" | "admin";

interface MatchingRemoteContainerGrant {
  accessEpoch: number;
  accessStateHash: string;
  createdAt: string | null;
  metadataDocumentId: string;
  referencedPrincipalHeads: ReadonlyArray<ReferencedPrincipalStateResponse>;
  updatedAt: string | null;
}

interface RemoteContainerShareContext {
  matchingGrant: MatchingRemoteContainerGrant | null;
  projection: ContainerWriterProjectionResponse;
}

function readOptionalProjectionString(
  projection: ContainerWriterProjectionResponse,
  key: string,
): string | null {
  const value = Reflect.get(projection, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function loadRemoteContainerShareContext(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  runtime: ContainerWorkflowRuntime;
  subjectId: string;
  subjectType: ContainerShareSubjectType;
}): Promise<RemoteContainerShareContext | null> {
  const projection = await loadContainerWriterProjectionForState({
    containerState: input.containerState,
    runtime: input.runtime,
  });
  if (!projection) {
    return null;
  }

  const target = getTargetContainerContext(projection);
  const remoteState = readContainerState(target.manifest);
  const hasMatchingGrant = remoteState.directGrants.some(
    (grant) =>
      grant.subjectType === input.subjectType &&
      grant.subjectId === input.subjectId &&
      grant.accessLevel === input.accessLevel,
  );
  if (!hasMatchingGrant) {
    return { matchingGrant: null, projection };
  }

  return {
    matchingGrant: {
      accessEpoch: remoteState.epoch,
      accessStateHash: target.manifest.manifestHash,
      createdAt: readOptionalProjectionString(projection, "createdAt"),
      metadataDocumentId: remoteState.metadataDocumentId,
      referencedPrincipalHeads: remoteState.referencedPrincipalHeads,
      updatedAt: readOptionalProjectionString(projection, "updatedAt"),
    },
    projection,
  };
}

async function persistSharedContainerState(input: {
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerWorkflowRuntime;
  shared: SharedRemoteContainerState;
}): Promise<SharedContainerState> {
  await input.runtime.util.cacheReferencedPrincipalPolicies(
    input.shared.referencedPrincipalHeads,
  );
  input.containerState.container = {
    ...input.containerState.container,
    createdAt: input.shared.createdAt,
    serverCreatedAt: input.shared.createdAt,
    serverUpdatedAt: input.shared.updatedAt,
    updatedAt: input.shared.updatedAt,
  };

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: input.containerState,
    patch: {
      accessEpoch: input.shared.accessEpoch,
      accessStateHash: input.shared.accessManifestHash,
      documentId: input.shared.metadataDocumentId,
      metadataDocumentId: input.shared.metadataDocumentId,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
    persistence: input.persistence,
    runtime: input.runtime,
  });
  input.containerState.containerWriterProjection =
    input.shared.writerProjection;

  return {
    container: persisted.container,
    record: persisted.record,
  };
}

async function persistDuplicateContainerShare(input: {
  containerState: ContainerState;
  grant: MatchingRemoteContainerGrant;
  persistence: ContainerContentsPersistence;
  projection: ContainerWriterProjectionResponse;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedContainerState> {
  await input.runtime.util.cacheReferencedPrincipalPolicies([
    ...input.grant.referencedPrincipalHeads,
  ]);
  input.containerState.container = {
    ...input.containerState.container,
    ...(input.grant.createdAt
      ? {
          createdAt: input.grant.createdAt,
          serverCreatedAt: input.grant.createdAt,
        }
      : {}),
    ...(input.grant.updatedAt
      ? {
          serverUpdatedAt: input.grant.updatedAt,
          updatedAt: input.grant.updatedAt,
        }
      : {}),
  };
  const securityContextChanged =
    input.containerState.record.documentId !== input.grant.metadataDocumentId ||
    input.containerState.record.accessEpoch !== input.grant.accessEpoch ||
    input.containerState.record.accessStateHash !== input.grant.accessStateHash;
  const patch: Partial<ContainerMetadataPatch> = {
    accessEpoch: input.grant.accessEpoch,
    accessStateHash: input.grant.accessStateHash,
    documentId: input.grant.metadataDocumentId,
    metadataDocumentId: input.grant.metadataDocumentId,
    ...(securityContextChanged
      ? {
          contentKeyBundle: null,
          documentKekTargets: null,
          documentManifestBundle: null,
        }
      : {}),
  };
  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: input.containerState,
    patch,
    persistence: input.persistence,
    runtime: input.runtime,
  });
  input.containerState.containerWriterProjection = input.projection;

  return {
    container: persisted.container,
    record: persisted.record,
  };
}

export async function shareContainerState(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedContainerState | null> {
  const shareContext = await loadRemoteContainerShareContext({
    accessLevel: input.accessLevel,
    containerState: input.containerState,
    runtime: input.runtime,
    subjectId: input.recipientUserId,
    subjectType: "user",
  });
  if (!shareContext) {
    return null;
  }
  if (shareContext.matchingGrant) {
    input.runtime.util.log(
      `Container contents: skipped duplicate share for container ${input.containerState.container.id} with user ${input.recipientUserId}`,
    );
    return persistDuplicateContainerShare({
      containerState: input.containerState,
      grant: shareContext.matchingGrant,
      persistence: input.persistence,
      projection: shareContext.projection,
      runtime: input.runtime,
    });
  }

  const shared = await shareRemoteContainer({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    previousProjection: shareContext.projection,
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
  });

  if (!shared) {
    return null;
  }

  return persistSharedContainerState({
    containerState: input.containerState,
    persistence: input.persistence,
    runtime: input.runtime,
    shared,
  });
}

export async function shareContainerStateWithGroup(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  recipientGroupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedContainerState | null> {
  const shareContext = await loadRemoteContainerShareContext({
    accessLevel: input.accessLevel,
    containerState: input.containerState,
    runtime: input.runtime,
    subjectId: input.recipientGroupId,
    subjectType: "group",
  });
  if (!shareContext) {
    return null;
  }
  if (shareContext.matchingGrant) {
    input.runtime.util.log(
      `Container contents: skipped duplicate share for container ${input.containerState.container.id} with group ${input.recipientGroupId}`,
    );
    return persistDuplicateContainerShare({
      containerState: input.containerState,
      grant: shareContext.matchingGrant,
      persistence: input.persistence,
      projection: shareContext.projection,
      runtime: input.runtime,
    });
  }

  const shared = await shareRemoteContainerWithGroup({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    previousProjection: shareContext.projection,
    recipientGroupId: input.recipientGroupId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
  });

  if (!shared) {
    return null;
  }

  return persistSharedContainerState({
    containerState: input.containerState,
    persistence: input.persistence,
    runtime: input.runtime,
    shared,
  });
}
