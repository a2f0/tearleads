import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type {
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  assertSealedContainerKekKeyringLength,
  computeContainerKekKeyringHash,
  computeContainerKekPredecessorBridgeHash,
  computeContainerKeyEpochHash,
  MAX_CONTAINER_KEY_EPOCH,
  normalizeContainerAccessEventBody,
  verifyContainerKekState,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { inArray } from "drizzle-orm";
import {
  getContainerKeyEpochKeyring,
  getCurrentContainerKeyEpoch,
} from "../../../../access/read/containerKekStore";
import { ContainerMutationError } from "../errors";
import {
  readContainerKekKeyring,
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
  readonly keyring: ContainerKekKeyring | null;
  readonly predecessorBridge: ContainerKekPredecessorBridge | null;
  readonly verifiedState: VerifiedContainerKekState;
}

interface VerifiedRotationArtifacts {
  readonly keyring: ContainerKekKeyring | null;
  readonly predecessorBridge: ContainerKekPredecessorBridge | null;
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

function requestedKeyring(
  request: ContainerMutationRequest,
): ContainerKekKeyring | null {
  return request.keyring === null
    ? null
    : readContainerKekKeyring(request.keyring, "keyring");
}

function assertRotationKeyringShape(
  keyring: ContainerKekKeyring | null,
  keyEpoch: ContainerKeyEpoch,
  containerId: string,
): asserts keyring is ContainerKekKeyring {
  if (
    keyring === null ||
    keyring.containerId !== containerId ||
    keyring.containerKeyEpochId !== keyEpoch.id
  ) {
    throw new ContainerMutationError(
      "Container KEK rotation requires a keyring sealed to its new epoch",
      409,
    );
  }
  try {
    // The exact-length equality: the sealed blob for epoch n has one valid
    // ciphertext length, so over- and under-length payloads reject before
    // any of them can be stored.
    assertSealedContainerKekKeyringLength(keyring, keyEpoch.keyEpoch);
  } catch {
    throw new ContainerMutationError(
      "Container KEK keyring length does not match its key epoch",
      409,
    );
  }
}

function verifyInitialEpochArtifacts(input: {
  readonly bridge: ContainerKekPredecessorBridge | null;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly keyring: ContainerKekKeyring | null;
  readonly manifest: VerifiedContainerAccessManifest;
}): VerifiedRotationArtifacts {
  if (
    input.manifest.event.event.eventType !== "container.create" ||
    input.keyEpoch.keyEpoch !== 1
  ) {
    throw new ContainerMutationError(
      "Initial container KEK epoch is invalid",
      409,
    );
  }
  if (input.bridge !== null || input.keyring !== null) {
    throw new ContainerMutationError(
      "Initial container KEK epoch cannot have rotation artifacts",
      409,
    );
  }
  return { keyring: null, predecessorBridge: null };
}

function assertRotationEpochAdvance(
  keyEpoch: ContainerKeyEpoch,
  currentKeyEpoch: number,
): void {
  if (keyEpoch.keyEpoch <= currentKeyEpoch) {
    throw new ContainerMutationError("Container KEK epoch is stale", 409);
  }
  if (keyEpoch.keyEpoch > currentKeyEpoch + 1) {
    throw new ContainerMutationError(
      "Container KEK rotation must advance by exactly one epoch",
      409,
    );
  }
}

async function assertRotationEventCommitments(input: {
  readonly bridge: ContainerKekPredecessorBridge;
  readonly keyring: ContainerKekKeyring;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<void> {
  const eventBody = normalizeContainerAccessEventBody(
    input.manifest.event.body,
  );
  if (
    (eventBody.eventType !== "container.move" &&
      eventBody.eventType !== "container.rekey" &&
      eventBody.eventType !== "container.revoke") ||
    eventBody.predecessorBridgeHash !==
      (await computeContainerKekPredecessorBridgeHash(input.bridge))
  ) {
    throw new ContainerMutationError(
      "Container KEK predecessor bridge does not match its signed event",
      409,
    );
  }
  if (
    eventBody.keyringHash !==
    (await computeContainerKekKeyringHash(input.keyring))
  ) {
    throw new ContainerMutationError(
      "Container KEK keyring does not match its signed event",
      409,
    );
  }
}

async function verifyRotationArtifacts(input: {
  readonly executor: DatabaseTransaction;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly request: ContainerMutationRequest;
}): Promise<VerifiedRotationArtifacts> {
  const { executor, keyEpoch, manifest, request } = input;
  const bridge = requestedPredecessorBridge(request);
  const keyring = requestedKeyring(request);
  const currentEpoch = await getCurrentContainerKeyEpoch(
    manifest.state.containerId,
    executor,
  );

  if (keyEpoch.keyEpoch > MAX_CONTAINER_KEY_EPOCH) {
    // Runaway-rotation backstop, unreachable by legitimate use. Clients must
    // not retry this from the outbox.
    throw new ContainerMutationError(
      "Container KEK rotation limit reached",
      409,
    );
  }

  if (!currentEpoch) {
    return verifyInitialEpochArtifacts({ bridge, keyEpoch, keyring, manifest });
  }

  if (keyEpoch.id === currentEpoch.id) {
    if (keyEpoch.keyEpoch !== currentEpoch.keyEpoch) {
      throw new ContainerMutationError("Container KEK epoch is stale", 409);
    }
    if (bridge !== null || keyring !== null) {
      throw new ContainerMutationError(
        "An unchanged container KEK cannot replace its rotation artifacts",
        409,
      );
    }
    // Epoch lookups omit the keyring blob, so re-read the stored artifact
    // this unchanged epoch keeps.
    return {
      keyring: await getContainerKeyEpochKeyring(currentEpoch.id, executor),
      predecessorBridge: currentEpoch.predecessorBridge,
    };
  }

  assertRotationEpochAdvance(keyEpoch, currentEpoch.keyEpoch);

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
  assertRotationKeyringShape(keyring, keyEpoch, manifest.state.containerId);
  await assertRotationEventCommitments({ bridge, keyring, manifest });

  return { keyring, predecessorBridge: bridge };
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
  const rotationArtifacts = await verifyRotationArtifacts({
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

  return { ...rotationArtifacts, verifiedState: result.value };
}
