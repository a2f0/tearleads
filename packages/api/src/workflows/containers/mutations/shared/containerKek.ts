import type {
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
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
import {
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

async function assertUserRecipientKeysCurrent(
  executor: DatabaseExecutor,
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
  artifacts: VerifyContainerKekFromRequestArtifacts,
): Promise<VerifiedContainerKekState> {
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

  return result.value;
}
