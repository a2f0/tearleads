import {
  type ContainerGrantPrincipalHead,
  type ContainerKekRecipientTarget,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  derivePrincipalRecipientKeyEpochId,
  encryptWithDek,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import type { AccessManifestBundleWire } from "@symcrypt/validators/request";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { readManifestContainerId } from "../../documents/shared/readers";
import {
  readCanonicalManifestBundle,
  readContainerAccessManifestState,
} from "./readers";
import type { ParentContainerCreateContext } from "./types";

export function uniqueSortedManifestHashes(
  path: readonly ContainerWriterProjectionResponse["path"][number][],
): string[] {
  return [...new Set(path.map((bundle) => bundle.manifestHash))].sort();
}

interface LeafContainerContextErrors {
  readonly emptyProjection: string;
  readonly inconsistentKek: string;
  readonly inconsistentPath: string;
  readonly inconsistentTarget: string;
  readonly staleKek: string;
}

function getLeafContainerContext(
  projection: ContainerWriterProjectionResponse,
  errors: LeafContainerContextErrors,
): ParentContainerCreateContext {
  if (projection.path.length !== projection.containerKeks.length) {
    throw new Error(errors.inconsistentPath);
  }

  const manifest = projection.path.at(-1);
  const kek = projection.containerKeks.at(-1);
  if (!manifest || !kek) {
    throw new Error(errors.emptyProjection);
  }
  if (readManifestContainerId(manifest) !== projection.containerId) {
    throw new Error(errors.inconsistentTarget);
  }
  if (kek.containerId !== projection.containerId) {
    throw new Error(errors.inconsistentKek);
  }
  if (kek.accessManifestHash !== manifest.manifestHash) {
    throw new Error(errors.staleKek);
  }

  return { manifest, kek };
}

export function getParentCreateContext(
  parentProjection: ContainerWriterProjectionResponse,
): ParentContainerCreateContext {
  return getLeafContainerContext(parentProjection, {
    emptyProjection: "Container parent projection is empty",
    inconsistentKek: "Container parent KEK target is inconsistent",
    inconsistentPath:
      "Container parent projection path and KEKs are inconsistent",
    inconsistentTarget: "Container parent projection target is inconsistent",
    staleKek: "Container parent KEK is stale",
  });
}

export function asContainerManifestBundle(
  bundle: ContainerWriterProjectionResponse["path"][number],
): AccessManifestBundleWire {
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
  return getLeafContainerContext(projection, {
    emptyProjection: "Container projection is empty",
    inconsistentKek: "Container target KEK is inconsistent",
    inconsistentPath: "Container projection path and KEKs are inconsistent",
    inconsistentTarget: "Container projection target is inconsistent",
    staleKek: "Container target KEK is stale",
  });
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

export async function wrapContainerKeyToManagedPrincipal(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  principalEncapsulationPublicKey: string;
  principalHead: ContainerGrantPrincipalHead;
}): Promise<{
  recipientTarget: ContainerKekRecipientTarget;
  wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    base64ToBytes(input.principalEncapsulationPublicKey),
  ]);
  if (!recipient) {
    throw new Error(
      "Container managed principal recipient wrap is unavailable",
    );
  }

  const recipientTarget: ContainerKekRecipientTarget = {
    recipientKind: input.principalHead.principalType,
    recipientId: input.principalHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      input.principalHead,
    ),
    recipientKeyFingerprint: input.principalHead.keyFingerprint,
  };

  return {
    recipientTarget,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: recipientTarget.recipientKind,
      recipientId: recipientTarget.recipientId,
      recipientKeyEpochId: recipientTarget.recipientKeyEpochId,
      recipientKeyFingerprint: recipientTarget.recipientKeyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}
