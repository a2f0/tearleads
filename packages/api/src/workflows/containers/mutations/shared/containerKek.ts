import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type {
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeContainerKekPredecessorBridgeHash,
  computeContainerKeyEpochHash,
  normalizeContainerAccessEventBody,
  verifyContainerKekState,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { inArray } from "drizzle-orm";
import { getCurrentContainerKeyEpoch } from "../../../../access/read/containerKekStore";
import { ContainerMutationError } from "../errors";
import {
  readContainerKekPredecessorBridge,
  readContainerKeyEpoch,
  readContainerKeyWraps,
  readVerifiedContainerKekState,
  userRecipientKeysFromRequest,
} from "./containerKekRecords";
import { canonicalJsonEquals, toContainerKeyEpoch } from "./util";

interface VerifyContainerKekFromRequestArtifacts {
  readonly containerManifestHistory?:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}

export interface VerifiedContainerKekMutationState {
  readonly predecessorBridge: ContainerKekPredecessorBridge | null;
  readonly verifiedState: VerifiedContainerKekState;
}

function requestedPredecessorBridge(
  request: ContainerMutationRequest,
): ContainerKekPredecessorBridge | null {
  return request.predecessorBridge === null
    ? null
    : readContainerKekPredecessorBridge(
        request.predecessorBridge,
        "predecessorBridge",
      );
}

async function verifyPredecessorBridge(input: {
  readonly executor: DatabaseTransaction;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly request: ContainerMutationRequest;
}): Promise<ContainerKekPredecessorBridge | null> {
  const { executor, keyEpoch, manifest, request } = input;
  const bridge = requestedPredecessorBridge(request);
  const currentEpoch = await getCurrentContainerKeyEpoch(
    manifest.state.containerId,
    executor,
  );

  if (!currentEpoch) {
    if (
      manifest.event.event.eventType !== "container.create" ||
      keyEpoch.keyEpoch !== 1
    ) {
      throw new ContainerMutationError(
        "Initial container KEK epoch is invalid",
        409,
      );
    }
    if (bridge !== null) {
      throw new ContainerMutationError(
        "Initial container KEK epoch cannot have a predecessor bridge",
        409,
      );
    }
    return null;
  }

  if (keyEpoch.id === currentEpoch.id) {
    if (keyEpoch.keyEpoch !== currentEpoch.keyEpoch) {
      throw new ContainerMutationError("Container KEK epoch is stale", 409);
    }
    if (bridge !== null) {
      throw new ContainerMutationError(
        "An unchanged container KEK cannot replace its predecessor bridge",
        409,
      );
    }
    return currentEpoch.predecessorBridge;
  }

  if (keyEpoch.keyEpoch <= currentEpoch.keyEpoch) {
    throw new ContainerMutationError("Container KEK epoch is stale", 409);
  }

  if (keyEpoch.keyEpoch > currentEpoch.keyEpoch + 1) {
    throw new ContainerMutationError(
      "Container KEK rotation must advance by exactly one epoch",
      409,
    );
  }

  if (
    bridge === null ||
    bridge.containerId !== manifest.state.containerId ||
    bridge.predecessorContainerKeyEpochId !== currentEpoch.id ||
    bridge.successorContainerKeyEpochId !== keyEpoch.id
  ) {
    throw new ContainerMutationError(
      "Container KEK rotation requires its immediate predecessor bridge",
      409,
    );
  }

  const eventBody = normalizeContainerAccessEventBody(manifest.event.body);
  if (
    (eventBody.eventType !== "container.move" &&
      eventBody.eventType !== "container.rekey" &&
      eventBody.eventType !== "container.revoke") ||
    eventBody.predecessorBridgeHash !==
      (await computeContainerKekPredecessorBridgeHash(bridge))
  ) {
    throw new ContainerMutationError(
      "Container KEK predecessor bridge does not match its signed event",
      409,
    );
  }

  return bridge;
}

async function assertUserRecipientKeysCurrent(
  executor: DatabaseTransaction,
  userRecipientKeys: readonly ContainerUserRecipientKey[],
): Promise<void> {
  if (userRecipientKeys.length === 0) {
    return;
  }

  const userIds = [...new Set(userRecipientKeys.map((key) => key.userId))];
  const storedUsers = await executor
    .select({
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      id: users.id,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const storedUserById = new Map(storedUsers.map((user) => [user.id, user]));

  for (const key of userRecipientKeys) {
    const storedUser = storedUserById.get(key.userId);
    if (!storedUser) {
      throw new ContainerMutationError("Recipient user not found", 409);
    }

    if (
      storedUser.encapsulationKeyFingerprint !== key.recipientKeyFingerprint
    ) {
      throw new ContainerMutationError(
        "Recipient user key fingerprint is stale",
        409,
      );
    }
  }
}

async function assertParentKekStateCurrent(
  executor: DatabaseTransaction,
  manifest: VerifiedContainerAccessManifest,
  parentKekState: VerifiedContainerKekState | null,
): Promise<void> {
  if (!manifest.state.parentContainerId) {
    return;
  }

  if (!parentKekState) {
    throw new ContainerMutationError("Parent KEK state is required", 409);
  }

  if (parentKekState.containerId !== manifest.state.parentContainerId) {
    throw new ContainerMutationError(
      "Parent KEK state container mismatch",
      409,
    );
  }

  const currentParentEpoch = await getCurrentContainerKeyEpoch(
    parentKekState.containerId,
    executor,
  );
  if (!currentParentEpoch) {
    throw new ContainerMutationError("Parent KEK state missing", 404);
  }

  const currentParentKeyEpoch = toContainerKeyEpoch(currentParentEpoch);
  const currentParentKeyEpochHash = await computeContainerKeyEpochHash(
    currentParentKeyEpoch,
  );

  if (
    parentKekState.containerKeyEpochId !== currentParentKeyEpoch.id ||
    parentKekState.keyEpochHash !== currentParentKeyEpochHash ||
    !canonicalJsonEquals(parentKekState.keyEpoch, currentParentKeyEpoch)
  ) {
    throw new ContainerMutationError("Parent KEK state is stale", 409);
  }
}

export async function verifyContainerKekFromRequest(
  executor: DatabaseTransaction,
  request: ContainerMutationRequest,
  manifest: VerifiedContainerAccessManifest,
  artifacts: VerifyContainerKekFromRequestArtifacts,
): Promise<VerifiedContainerKekMutationState> {
  const userRecipientKeys = userRecipientKeysFromRequest(request);
  const parentKekState =
    request.parentKekState === undefined || request.parentKekState === null
      ? null
      : readVerifiedContainerKekState(request.parentKekState, "parentKekState");

  await assertUserRecipientKeysCurrent(executor, userRecipientKeys);
  await assertParentKekStateCurrent(executor, manifest, parentKekState);

  const keyEpoch: ContainerKeyEpoch = readContainerKeyEpoch(
    request.keyEpoch,
    "keyEpoch",
  );
  const wraps: ContainerKeyWrap[] = readContainerKeyWraps(
    request.wraps,
    "wraps",
  );
  const predecessorBridge = await verifyPredecessorBridge({
    executor,
    keyEpoch,
    manifest,
    request,
  });
  const result = await verifyContainerKekState({
    containerManifest: manifest,
    keyEpoch,
    parentKekState,
    principalPolicies: artifacts.principalPolicies,
    userRecipientKeys,
    wraps,
    ...(artifacts.containerManifestHistory !== undefined
      ? { containerManifestHistory: artifacts.containerManifestHistory }
      : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return { predecessorBridge, verifiedState: result.value };
}
