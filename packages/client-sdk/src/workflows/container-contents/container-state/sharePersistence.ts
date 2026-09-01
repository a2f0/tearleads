import type {
  ContainerWriterProjectionResponse,
  ReferencedPrincipalStateResponse,
} from "@symcrypt/validators/response";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import type { ContainerContentsPersistence } from "../containerPersistence";
import {
  type ContainerMetadataPatch,
  persistContainerMetadataStateFromRuntime,
} from "../metadata";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "../metadataStateIsolation";
import type { ContainerState } from "../remoteHydration";
import type {
  ContainerWorkflowRuntime,
  SharedContainerStateResult,
  SharedRemoteContainerState,
} from "./types";

export interface MatchingRemoteContainerGrant {
  accessEpoch: number;
  accessStateHash: string;
  createdAt: string | null;
  metadataDocumentId: string;
  referencedPrincipalHeads: ReadonlyArray<ReferencedPrincipalStateResponse>;
  updatedAt: string | null;
}

export async function persistSharedContainerState(input: {
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerWorkflowRuntime;
  shared: SharedRemoteContainerState;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<SharedContainerStateResult | null> {
  if (input.stillCurrent?.() === false) return null;
  await createRuntimePrincipalPolicyWarmer(input.runtime)({
    organizationId: input.shared.writerProjection.organizationId,
    references: input.shared.referencedPrincipalHeads,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;
  const candidateState = await createDetachedContainerMetadataState(
    input.containerState,
  );
  if (input.stillCurrent?.() === false) return null;
  candidateState.container = {
    ...input.containerState.container,
    createdAt: input.shared.createdAt,
    serverCreatedAt: input.shared.createdAt,
    serverUpdatedAt: input.shared.updatedAt,
    updatedAt: input.shared.updatedAt,
  };

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: candidateState,
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
    stillCurrent: input.stillCurrent,
    saveOptions: {
      serverTimestamps: {
        createdAt: input.shared.createdAt,
        updatedAt: input.shared.updatedAt,
      },
    },
  });
  if (input.stillCurrent?.() === false) return null;
  if (!persisted) return { status: "missing" };
  candidateState.container = persisted.container;
  installDetachedContainerMetadataState(input.containerState, candidateState, {
    candidateRecord: persisted.record,
    preserveConcurrentMetadataEdit: true,
  });
  if (persisted.mutationSuperseded || persisted.syncIdentitySuperseded) {
    return {
      container: input.containerState.container,
      record: input.containerState.record,
      status: "identity-superseded",
    };
  }
  input.containerState.containerWriterProjection =
    input.shared.writerProjection;
  return {
    container: input.containerState.container,
    record: input.containerState.record,
    status: "persisted",
  };
}

export async function persistDuplicateContainerShare(input: {
  containerState: ContainerState;
  grant: MatchingRemoteContainerGrant;
  persistence: ContainerContentsPersistence;
  projection: ContainerWriterProjectionResponse;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<SharedContainerStateResult | null> {
  if (input.stillCurrent?.() === false) return null;
  await createRuntimePrincipalPolicyWarmer(input.runtime)({
    organizationId: input.projection.organizationId,
    references: input.grant.referencedPrincipalHeads,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;
  const candidateState = await createDetachedContainerMetadataState(
    input.containerState,
  );
  if (input.stillCurrent?.() === false) return null;
  candidateState.container = {
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
    candidateState.record.documentId !== input.grant.metadataDocumentId ||
    candidateState.record.accessEpoch !== input.grant.accessEpoch ||
    candidateState.record.accessStateHash !== input.grant.accessStateHash;
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
    metadataState: candidateState,
    patch,
    persistence: input.persistence,
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
    saveOptions: {
      serverTimestamps: {
        createdAt: input.grant.createdAt,
        updatedAt: input.grant.updatedAt,
      },
    },
  });
  if (input.stillCurrent?.() === false) return null;
  if (!persisted) return { status: "missing" };
  candidateState.container = persisted.container;
  installDetachedContainerMetadataState(input.containerState, candidateState, {
    candidateRecord: persisted.record,
    preserveConcurrentMetadataEdit: true,
  });
  if (persisted.mutationSuperseded || persisted.syncIdentitySuperseded) {
    return {
      container: input.containerState.container,
      record: input.containerState.record,
      status: "identity-superseded",
    };
  }
  input.containerState.containerWriterProjection = input.projection;
  return {
    container: input.containerState.container,
    record: input.containerState.record,
    status: "persisted",
  };
}
