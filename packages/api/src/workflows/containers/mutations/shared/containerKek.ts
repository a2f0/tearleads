import type {
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import {
  computeContainerKeyEpochHash,
  verifyContainerKekState,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { inArray } from "drizzle-orm";
import { getCurrentContainerKeyEpoch } from "../../../../access/read/containerKekStore";
import type { DatabaseExecutor } from "../../../../adapters/postgres";
import { users } from "../../../../schema";
import { ContainerMutationError } from "../errors";
import { readVerifiedContainerManifestArray } from "./accessManifestRecords";
import {
  readContainerKeyEpoch,
  readContainerKeyWraps,
  readVerifiedContainerKekState,
  userRecipientKeysFromRequest,
} from "./containerKekRecords";
import { principalPoliciesFromRequest } from "./principalPolicyRecords";
import { canonicalJsonEquals, toContainerKeyEpoch } from "./util";

async function assertUserRecipientKeysCurrent(
  executor: DatabaseExecutor,
  userRecipientKeys: readonly ContainerUserRecipientKey[],
): Promise<void> {
  if (userRecipientKeys.length === 0) {
    return;
  }

  for (const key of userRecipientKeys) {
    if (
      typeof key.userId !== "string" ||
      typeof key.recipientKeyEpochId !== "string" ||
      typeof key.recipientKeyFingerprint !== "string"
    ) {
      throw new ContainerMutationError("Invalid user recipient key", 400);
    }
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
  executor: DatabaseExecutor,
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
  executor: DatabaseExecutor,
  request: ContainerMutationRequest,
  manifest: VerifiedContainerAccessManifest,
): Promise<VerifiedContainerKekState> {
  const userRecipientKeys = userRecipientKeysFromRequest(request);
  const parentKekState =
    request.parentKekState === undefined || request.parentKekState === null
      ? null
      : readVerifiedContainerKekState(request.parentKekState, "parentKekState");

  await assertUserRecipientKeysCurrent(executor, userRecipientKeys);
  await assertParentKekStateCurrent(executor, manifest, parentKekState);

  const containerManifestHistory = readVerifiedContainerManifestArray(
    request.containerManifestHistory,
    "containerManifestHistory",
  );
  const result = await verifyContainerKekState({
    containerManifest: manifest,
    keyEpoch: readContainerKeyEpoch(request.keyEpoch, "keyEpoch"),
    parentKekState,
    principalPolicies: principalPoliciesFromRequest(request),
    userRecipientKeys,
    wraps: readContainerKeyWraps(request.wraps, "wraps"),
    ...(containerManifestHistory !== undefined
      ? { containerManifestHistory }
      : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}
