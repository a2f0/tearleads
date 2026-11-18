import type { ContainerAccessManifestState } from "@tearleads/crypto";
import { emptyVersionVector } from "@tearleads/loro";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { isContainerNotFoundFailure } from "../../../data/containers/shared/mutationFailures";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import { errorMessage } from "../../../data/shared/errorMessage";
import {
  type AppliedContainerMove,
  type ContainerMutationCollaborators,
  ContainerMutationService,
  signedContainerMetadataDocumentId,
  signedContainerReferencedPrincipalHeads,
} from "../../containers";
import { resolveDocumentCreateAuthor } from "../../documents";

import {
  type ContainerAlreadyCommitted,
  createRemoteContainerWithMetadataDocument,
} from "./create/createWithMetadata";
import type {
  ContainerCreateIntentSyncState,
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
  RemoteContainer,
  SharedRemoteContainerState,
} from "./types";

/**
 * Resolve the author and the runtime snapshot's container mutation
 * collaborators, with a service bound to them, logging a skip for the given
 * operation when the writer context is unavailable.
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

  const collaborators: ContainerMutationCollaborators<
    ContainerWorkflowRuntime["apiClient"]
  > = {
    api: runtime.apiClient,
    encapsulationSecretKey: secretKey,
    execSql: runtime.infra.execSql,
    reportSecurityIncident: runtime.util.reportSecurityIncident,
    resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
  };
  return {
    author,
    collaborators,
    containers: new ContainerMutationService(collaborators),
  };
}

export async function createRemoteContainer(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  containerId: string;
  metadataSeedUpdate?: Parameters<
    typeof createRemoteContainerWithMetadataDocument
  >[0]["metadataSeedUpdate"];
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<CreatedRemoteContainerState | ContainerAlreadyCommitted | null> {
  return createRemoteContainerWithMetadataDocument(input);
}

/** An acknowledged mutation: the server's commitments and the signed plan. */
interface AcknowledgedContainerMutation {
  readonly plan: { readonly state: ContainerAccessManifestState };
  readonly response: ContainerMutationResponse;
}

function sharedRemoteContainerStateFromMutation(
  previousProjection: ContainerWriterProjectionResponse,
  { plan, response }: AcknowledgedContainerMutation,
): SharedRemoteContainerState {
  if (
    response.containerId !== previousProjection.containerId ||
    response.organizationId !== previousProjection.organizationId
  )
    throw new Error("Container mutation response projection mismatch");
  return {
    accessManifestHash: response.manifestHead.manifestHash,
    accessEpoch: response.manifestHead.epoch,
    createdAt: response.createdAt,
    metadataDocumentId: signedContainerMetadataDocumentId(plan),
    referencedPrincipalHeads: signedContainerReferencedPrincipalHeads(plan),
    updatedAt: response.updatedAt,
    // The next read obtains the post-commit proof. A failed read cannot undo
    // acknowledgement of this successful mutation.
    writerProjection: null,
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
  const shared = await writer.containers.shareRemoteContainer({
    accessLevel: input.accessLevel,
    author: writer.author,
    committedReadModel: input.runtime.organizations.committedReadModel({
      domainScope: input.runtime.state.domainScope,
      execSql: input.runtime.infra.execSql,
      organizationId: writer.author.organizationId,
      userId: writer.author.signerUserId,
    }),
    containerId: input.containerId,
    previousProjection: input.previousProjection,
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies:
      input.runtime.principalPolicies.createWarmer(),
  });
  if (!shared) {
    return null;
  }

  return sharedRemoteContainerStateFromMutation(
    input.previousProjection,
    shared,
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
  const { author, collaborators } = writer;

  const shareWithGroup = input.runtime.organizations.createCurrentGroupShare(
    input.runtime,
  );
  if (!shareWithGroup)
    throw new ProjectionDependencyUnavailableError(
      "Group sharing requires private paged recovery",
    );
  const shared = await shareWithGroup({
    reportSecurityIncident: collaborators.reportSecurityIncident,
    accessLevel: input.accessLevel,
    apiClient: collaborators.api,
    author,
    containerId: input.containerId,
    execSql: collaborators.execSql,
    expectedGroupName: input.expectedGroupName ?? null,
    readEncryptedName: (bundle) =>
      input.runtime.organizations.groupMetadataNameReader(
        input.runtime,
        author.organizationId,
        input.stillCurrent,
      )(bundle),
    knownContainerKeks: input.knownContainerKeks,
    previousProjection: input.previousProjection,
    recipientGroupId: input.recipientGroupId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    resolveTrustedUserIdentity: collaborators.resolveTrustedUserIdentity,
    signingKeyPair: input.runtime.crypto.signingKeyPair,
    stillCurrent: input.stillCurrent,
    targetSecretKey: collaborators.encapsulationSecretKey,
    warmReferencedPrincipalPolicies:
      input.runtime.principalPolicies.createWarmer(),
  });
  if (!shared) {
    return null;
  }

  return sharedRemoteContainerStateFromMutation(
    input.previousProjection,
    shared,
  );
}

/**
 * Replays a queued move. `applied` carries the verified head when the server
 * already holds the container under the destination, so nothing is posted.
 */
export async function moveRemoteContainer(input: {
  containerId: string;
  onAccepted?: (() => void) | undefined;
  parentContainerId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<
  { applied: AppliedContainerMove } | { moved: RemoteContainer } | null
> {
  const writer = resolveContainerWriterContext(input.runtime, "container move");
  if (!writer) {
    return null;
  }
  const replayed = await writer.containers.replayRemoteContainerMove({
    author: writer.author,
    containerId: input.containerId,
    destinationParentContainerId: input.parentContainerId,
    onAccepted: input.onAccepted,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies:
      input.runtime.principalPolicies.createWarmer(),
  });
  if (!replayed || "applied" in replayed) {
    return replayed;
  }

  const { plan, response } = replayed;
  return {
    moved: {
      createdAt: response.createdAt,
      effectiveAccessLevel: "admin",
      id: response.containerId,
      organizationId: response.organizationId,
      parentId: response.parentId,
      metadataDocumentId: signedContainerMetadataDocumentId(plan),
      metadataAccessEpoch: response.manifestHead.epoch,
      metadataAccessStateHash: response.manifestHead.manifestHash,
      metadataReferencedPrincipals:
        signedContainerReferencedPrincipalHeads(plan),
      // A move says nothing about the metadata document's version.
      metadataVersionVector: emptyVersionVector(),
      updatedAt: response.updatedAt,
    },
  };
}

export async function deleteRemoteContainer(input: {
  containerId: string;
  organizationId: string;
  requiredAncestorId?: string | undefined;
  runtime: ContainerWorkflowRuntime;
}): Promise<{ deletedAt: string } | null> {
  const deleteResult = await input.runtime.apiClient.deleteContainerResult(
    input.containerId,
    {
      expectedPaymentRequiredOrganizationId: input.organizationId,
      reportErrors: false,
      requiredAncestorId: input.requiredAncestorId,
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

/** Best-effort delete of a remote container whose local folder is gone. */
export async function discardOrphanedRemoteContainer(input: {
  created: CreatedRemoteContainerState;
  isCurrent: () => boolean;
  state: Pick<ContainerCreateIntentSyncState, "runtime">;
}): Promise<void> {
  if (!input.isCurrent()) {
    return;
  }
  const discardFailure = await deleteRemoteContainer({
    containerId: input.created.containerId,
    organizationId: input.created.organizationId,
    runtime: input.state.runtime,
  }).then(
    (deleted) => (deleted ? null : "the server rejected the delete"),
    (error: unknown) => errorMessage(error),
  );
  if (input.isCurrent() && discardFailure !== null) {
    input.state.runtime.util.log(
      `Container contents: failed to discard orphaned remote container ${input.created.containerId} after local delete: ${discardFailure}`,
    );
  }
}
