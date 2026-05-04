import {
  type ContainerKekRecipientTarget,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  encryptWithDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { ContainerManifestBundle } from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  readCanonicalManifestBundle,
  readContainerAccessManifestState,
} from "./readers";
import type { ParentContainerCreateContext } from "./types";

function readManifestContainerId(
  bundle: ContainerWriterProjectionResponse["path"][number],
): string | null {
  const containerId = isPlainObject(bundle.state)
    ? Reflect.get(bundle.state, "containerId")
    : undefined;

  return typeof containerId === "string" && containerId.length > 0
    ? containerId
    : null;
}

export function uniqueSortedManifestHashes(
  path: readonly ContainerWriterProjectionResponse["path"][number][],
): string[] {
  return [...new Set(path.map((bundle) => bundle.manifestHash))].sort();
}

export function getParentCreateContext(
  parentProjection: ContainerWriterProjectionResponse,
): ParentContainerCreateContext {
  if (parentProjection.path.length !== parentProjection.containerKeks.length) {
    throw new Error(
      "Container parent projection path and KEKs are inconsistent",
    );
  }

  const manifest = parentProjection.path.at(-1);
  const kek = parentProjection.containerKeks.at(-1);
  if (!manifest || !kek) {
    throw new Error("Container parent projection is empty");
  }
  if (readManifestContainerId(manifest) !== parentProjection.containerId) {
    throw new Error("Container parent projection target is inconsistent");
  }
  if (kek.containerId !== parentProjection.containerId) {
    throw new Error("Container parent KEK target is inconsistent");
  }
  if (kek.accessManifestHash !== manifest.manifestHash) {
    throw new Error("Container parent KEK is stale");
  }

  return { manifest, kek };
}

export function asContainerManifestBundle(
  bundle: ContainerWriterProjectionResponse["path"][number],
): ContainerManifestBundle {
  return readCanonicalManifestBundle(bundle, "Container manifest bundle");
}

export function readContainerState(
  bundle: ContainerWriterProjectionResponse["path"][number],
): ReturnType<typeof readContainerAccessManifestState> {
  return readContainerAccessManifestState(
    bundle.state,
    "Container manifest state",
  );
}

export function getTargetContainerContext(
  projection: ContainerWriterProjectionResponse,
): ParentContainerCreateContext {
  if (projection.path.length !== projection.containerKeks.length) {
    throw new Error("Container projection path and KEKs are inconsistent");
  }

  const manifest = projection.path.at(-1);
  const kek = projection.containerKeks.at(-1);
  if (!manifest || !kek) {
    throw new Error("Container projection is empty");
  }
  if (readManifestContainerId(manifest) !== projection.containerId) {
    throw new Error("Container projection target is inconsistent");
  }
  if (kek.containerId !== projection.containerId) {
    throw new Error("Container target KEK is inconsistent");
  }
  if (kek.accessManifestHash !== manifest.manifestHash) {
    throw new Error("Container target KEK is stale");
  }

  return { manifest, kek };
}

export function getParentKekForTarget(
  projection: ContainerWriterProjectionResponse,
): ContainerKekResponse | null {
  const targetState = readContainerState(
    getTargetContainerContext(projection).manifest,
  );
  if (!targetState.parentContainerId) {
    return null;
  }

  const parentKek = projection.containerKeks.at(-2);
  if (!parentKek || parentKek.containerId !== targetState.parentContainerId) {
    throw new Error("Container parent KEK is unavailable");
  }

  return parentKek;
}

export async function wrapContainerKeyToParent(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  parentKek: ContainerKekResponse;
  parentKekMaterial: Uint8Array;
}): Promise<ContainerKeyWrap> {
  const wrapped = await encryptWithDek(
    input.containerKey,
    input.parentKekMaterial,
  );

  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "container",
    recipientId: input.parentKek.containerId,
    recipientKeyEpochId: input.parentKek.containerKeyEpochId,
    recipientKeyFingerprint: input.parentKek.keyEpochHash,
    kemCipherText: bytesToBase64(wrapped.iv),
    wrappedKey: bytesToBase64(wrapped.ciphertext),
    wrapManifestHash: input.manifestHash,
  };
}

export async function wrapContainerKeyToRootUser(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  recipientEncapsulationPublicKey: Uint8Array;
  userId: string;
}): Promise<{
  recipientTarget: ContainerKekRecipientTarget;
  userRecipientKey: ContainerUserRecipientKey;
  wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    input.recipientEncapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Container root recipient wrap is unavailable");
  }

  const userRecipientKey: ContainerUserRecipientKey = {
    userId: input.userId,
    recipientKeyEpochId: `user:${input.userId}:encapsulation:${recipient.keyFingerprint}`,
    recipientKeyFingerprint: recipient.keyFingerprint,
  };
  const recipientTarget: ContainerKekRecipientTarget = {
    recipientKind: "user",
    recipientId: input.userId,
    recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
    recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
  };

  return {
    recipientTarget,
    userRecipientKey,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: "user",
      recipientId: input.userId,
      recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}
