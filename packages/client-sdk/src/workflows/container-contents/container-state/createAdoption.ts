import {
  type KeyingVerificationCode,
  KeyingVerificationError,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { errorMessage } from "../../../data/errorMessage";
import {
  verifiedContainerCreateManifest,
  verifyContainerDestinationProjection,
} from "../../../data/keyingProjectionVerification/containerDestinationVerification";
import {
  isKeyingVerificationError,
  reportKeyingVerificationErrorInCauseChain,
} from "../../../data/keyingProjectionVerification/error";
import type { ContainerState } from "../remoteHydration";
import { settleContainerCreateIntent } from "./createIntentSettlement";
import type {
  AdoptedContainerPlacement,
  ContainerCreateIntentSyncInput,
  ContainerCreateIntentSyncState,
} from "./types";

const LABEL = "Container create conflict";

/** The recorded error that parks an intent whose listed create is foreign. */
export const CONTAINER_CREATE_ADOPTION_REFUSED =
  "Container create adoption was refused";

/**
 * The listed create's signed identity is not this device's pending create: its
 * signed create names another signer, another organization, or a root. An honest server never lists that under the
 * id this device minted, and no later read can change those signed facts, so
 * the intent parks instead of re-verifying.
 */
class ForeignContainerCreateError extends KeyingVerificationError {}

function foreignCreate(
  code: KeyingVerificationCode,
  message: string,
): ForeignContainerCreateError {
  return new ForeignContainerCreateError(code, `${LABEL} ${message}`);
}

async function verifyAdoptableProjection(input: {
  readonly containerId: string;
  readonly expectedOrganizationId: string;
  readonly projection: ContainerWriterProjectionResponse;
  readonly sessionUserId: string;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<AdoptedContainerPlacement> {
  const { projection } = input;
  if (
    projection.containerId !== input.containerId ||
    projection.organizationId !== input.expectedOrganizationId
  ) {
    // The envelope is unsigned: a corrupt read is retried, not parked.
    throw new KeyingVerificationError(
      "object_mismatch",
      `${LABEL} projection has the wrong identity`,
    );
  }
  const { path, verifiedByHash } = await verifyContainerDestinationProjection({
    execSql: input.state.runtime.infra.execSql,
    projection,
    resolveUserKey: input.state.resolveProjectionUserKey,
  });
  const head = path.at(-1);
  // One read naming another container says nothing signed about this id.
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
  if (create.event.event.signerUserId !== input.sessionUserId) {
    throw foreignCreate("signer_mismatch", "was signed by another user");
  }
  if (create.state.organizationId !== input.expectedOrganizationId) {
    throw foreignCreate("object_mismatch", "belongs to another organization");
  }
  const createdParentId = create.state.parentContainerId;
  const currentParentId = head.state.parentContainerId;
  if (createdParentId === null || currentParentId === null) {
    throw foreignCreate("object_mismatch", "is an organization root");
  }
  return { createdParentId, currentParentId };
}

/**
 * A pending create whose container the listing already carries is adopted
 * only when the container's signed epoch-1 `container.create` is this user's,
 * in the intended organization (#2365 finding 26). Listing metadata is
 * unsigned: a create by another writer that collides on the pending id, or one
 * a dishonest server invents, must not become this device's container.
 * Documents apply the same rule (`workflows/documents/createAdoption.ts`).
 *
 * Returns where the create committed and where the verified head sits now.
 * The user may have moved the pending container since, which rewrites its
 * intent's parent; that is a move still owed, not a mismatch.
 */
async function assertContainerCreateAdoptable(input: {
  readonly containerId: string;
  readonly expectedOrganizationId: string;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<AdoptedContainerPlacement> {
  const { runtime } = input.state;
  const sessionUserId = runtime.auth.userId;
  // Without a session user there is no signer to compare: not tampering.
  if (!sessionUserId) {
    throw new Error(`${LABEL} needs a signed-in session user`);
  }
  const projection = await runtime.apiClient.getContainerWriterProjection(
    input.containerId,
  );
  if (!projection) {
    throw new Error(`${LABEL} is unavailable to verify`);
  }
  try {
    return await verifyAdoptableProjection({
      ...input,
      projection,
      sessionUserId,
    });
  } catch (error) {
    // Never re-serve a cached projection that failed verification.
    if (isKeyingVerificationError(error)) {
      runtime.apiClient.evictContainerWriterProjection(input.containerId);
    }
    throw error;
  }
}

function verifyListedContainerCreate(input: {
  readonly intent: ContainerCreateIntentSyncInput["intent"];
  readonly parentState: ContainerState;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<AdoptedContainerPlacement> {
  const adoption = {
    containerId: input.intent.containerId,
    expectedOrganizationId: input.parentState.container.organizationId,
  };
  return input.state.verifyCreateAdoption
    ? input.state.verifyCreateAdoption(adoption)
    : assertContainerCreateAdoptable({ ...adoption, state: input.state });
}

/** Settles a verified adoption against the row hydration installed. */
async function markContainerCreateIntentAdopted(input: {
  containerState: ContainerState;
  placement: AdoptedContainerPlacement;
  syncInput: ContainerCreateIntentSyncInput;
}): Promise<boolean> {
  const { containerState, placement, syncInput } = input;
  const remoteMetadataDocumentId = containerState.record.documentId;
  const remoteMetadataAccessStateHash = containerState.record.accessStateHash;

  if (!remoteMetadataDocumentId || !remoteMetadataAccessStateHash) {
    return false;
  }
  return settleContainerCreateIntent({
    createdParentContainerId: placement.createdParentId,
    desiredParentContainerId: syncInput.intent.parentContainerId,
    intent: syncInput.intent,
    isCurrent: syncInput.isCurrent,
    remoteContainerId: containerState.container.id,
    remoteMetadataAccessStateHash,
    remoteMetadataDocumentId,
    state: syncInput.state,
    supersededMovePreviousParentId: placement.currentParentId,
  });
}

/**
 * Records a failed adoption and leaves the lane's other intents to proceed. A
 * foreign create parks the intent: its signed facts never change, so later
 * passes neither re-read it nor report it again. Any other failure retries.
 */
async function recordAdoptionFailure(input: {
  readonly error: unknown;
  readonly organizationId: string;
  readonly syncInput: ContainerCreateIntentSyncInput;
}): Promise<"abandoned" | "failed"> {
  const { intent, isCurrent, state } = input.syncInput;
  if (!isCurrent()) return "abandoned";
  await reportKeyingVerificationErrorInCauseChain(
    input.error,
    state.runtime.util.reportSecurityIncident,
    {
      objectId: intent.containerId,
      objectKind: "container",
      operation: "container.create.replay",
      organizationId: input.organizationId,
    },
  );
  if (!isCurrent()) return "abandoned";
  const action =
    input.error instanceof ForeignContainerCreateError
      ? CONTAINER_CREATE_ADOPTION_REFUSED
      : "Container create adoption verification failed";
  await state.persistence.recordCreateIntentRevisionError(
    state.runtime.infra.execSql,
    {
      containerId: intent.containerId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      message: `${action}: ${errorMessage(input.error)}`,
      stillCurrent: isCurrent,
    },
  );
  return isCurrent() ? "failed" : "abandoned";
}

/**
 * Adopts a pending create the listing already carries, once its signed create
 * proves it is this device's. A parked refusal stays blocked without a read.
 */
export async function syncListedContainerCreate(input: {
  readonly containerState: ContainerState;
  readonly parentState: ContainerState;
  readonly syncInput: ContainerCreateIntentSyncInput;
}): Promise<"abandoned" | "blocked" | "created" | "failed"> {
  const { containerState, parentState, syncInput } = input;
  const { intent, isCurrent, state } = syncInput;
  if (intent.lastError?.startsWith(CONTAINER_CREATE_ADOPTION_REFUSED)) {
    return "blocked";
  }
  let placement: AdoptedContainerPlacement;
  try {
    placement = await verifyListedContainerCreate({
      intent,
      parentState,
      state,
    });
  } catch (error) {
    return recordAdoptionFailure({
      error,
      organizationId: parentState.container.organizationId,
      syncInput,
    });
  }
  const marked = await markContainerCreateIntentAdopted({
    containerState,
    placement,
    syncInput,
  });
  if (!marked) return isCurrent() ? "blocked" : "abandoned";
  // The folder now sits elsewhere; list it there rather than waiting for the
  // next poll to correct the local parent.
  if (placement.currentParentId !== intent.parentContainerId) {
    syncInput.requestRemoteReconciliation(placement.currentParentId);
  }
  return "created";
}
