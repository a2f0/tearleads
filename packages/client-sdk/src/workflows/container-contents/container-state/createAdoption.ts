import { KeyingVerificationError } from "@tearleads/crypto";
import {
  verifiedContainerCreateManifest,
  verifyContainerDestinationProjection,
} from "../../../data/keyingProjectionVerification/containerDestinationVerification";
import type { ContainerState } from "../remoteHydration";
import { settleContainerCreateIntent } from "./createIntentSettlement";
import type {
  ContainerCreateIntentSyncInput,
  ContainerCreateIntentSyncState,
} from "./types";

const LABEL = "Container create conflict";

/**
 * A pending create whose container the listing already carries is adopted
 * only when the container's signed epoch-1 `container.create` is this user's,
 * in the intended organization, under the intended parent (#2365 finding 26).
 * Listing metadata is unsigned: a create by another writer that collides on
 * the pending id, or one a dishonest server invents, must not become this
 * device's container. Documents apply the same rule (`createAdoption.ts`).
 */
export async function assertContainerCreateAdoptable(input: {
  readonly containerId: string;
  readonly expectedOrganizationId: string;
  readonly expectedParentContainerId: string;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<void> {
  const { runtime } = input.state;
  const projection = await runtime.apiClient.getContainerWriterProjection(
    input.containerId,
  );
  if (!projection) {
    throw new Error(`${LABEL} is unavailable to verify`);
  }
  const { path, verifiedByHash } = await verifyContainerDestinationProjection({
    execSql: runtime.infra.execSql,
    projection,
    resolveUserKey: input.state.resolveProjectionUserKey,
  });
  const head = path.at(-1);
  if (!head || head.state.containerId !== input.containerId) {
    throw new KeyingVerificationError(
      "object_mismatch",
      `${LABEL} projection names another container`,
    );
  }
  const create = verifiedContainerCreateManifest({
    head,
    label: LABEL,
    verifiedByHash,
  });
  if (create.event.event.signerUserId !== runtime.auth.userId) {
    throw new KeyingVerificationError(
      "signer_mismatch",
      `${LABEL} was signed by another user`,
    );
  }
  if (
    create.state.organizationId !== input.expectedOrganizationId ||
    create.state.parentContainerId !== input.expectedParentContainerId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      `${LABEL} belongs to another organization or parent`,
    );
  }
}

/** Checks a listed container before its pending create intent settles. */
export function verifyListedContainerCreate(input: {
  readonly intent: ContainerCreateIntentSyncInput["intent"];
  readonly parentState: ContainerState;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<void> {
  const adoption = {
    containerId: input.intent.containerId,
    expectedOrganizationId: input.parentState.container.organizationId,
    expectedParentContainerId: input.intent.parentContainerId,
  };
  return input.state.verifyCreateAdoption
    ? input.state.verifyCreateAdoption(adoption)
    : assertContainerCreateAdoptable({ ...adoption, state: input.state });
}

/** Settles a verified adoption against the row hydration installed. */
export async function markContainerContentsContainerCreateIntentAlreadySynced(input: {
  containerState: ContainerState;
  isCurrent: () => boolean;
  intent: ContainerCreateIntentSyncInput["intent"];
  state: ContainerCreateIntentSyncState;
}): Promise<boolean> {
  const { containerState, intent, state } = input;
  const remoteMetadataDocumentId = containerState.record.documentId;
  const remoteMetadataAccessStateHash = containerState.record.accessStateHash;

  if (!remoteMetadataDocumentId || !remoteMetadataAccessStateHash) {
    return false;
  }
  return settleContainerCreateIntent({
    intent,
    isCurrent: input.isCurrent,
    remoteContainerId: containerState.container.id,
    remoteMetadataAccessStateHash,
    remoteMetadataDocumentId,
    state,
    supersededMovePreviousParentId: intent.parentContainerId,
  });
}
