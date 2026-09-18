import {
  type ContainerKeyWrap,
  deriveContainerKekWrappingPublicKey,
  unwrapContainerKekParentWrap,
} from "@tearleads/crypto";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { projectionKekLabel } from "./containerKekPathHistory";
import { readManifestContainerId } from "./readers";
import type { UnwrappedContainerKek } from "./types";

export async function unwrapContainerKekFromParentWrap(input: {
  label: string;
  parentContainerKeyEpochId: string | null;
  parentKeksByEpochId: ReadonlyMap<string, UnwrappedContainerKek>;
  wraps: readonly ContainerKeyWrap[];
}): Promise<Uint8Array | null> {
  if (!input.parentContainerKeyEpochId) {
    return null;
  }

  const parentKek = input.parentKeksByEpochId.get(
    input.parentContainerKeyEpochId,
  );
  if (!parentKek) {
    return null;
  }

  // The epoch-record fingerprint is a SELECTOR for picking the right envelope
  // among several, not the security boundary — the AEAD tag below is what
  // authenticates the parent key. Keyring-recovered historical KEKs carry no
  // epoch record (only the material and the epoch id that commits to it), so
  // for those the epoch id alone selects and decryption authenticates.
  //
  // Without this, an ancestor rotation would strand every descendant still
  // pinned to the predecessor epoch: opening the descendant requires the
  // parent's historical KEK, and that is exactly the key a lazy rekey needs in
  // order to materialize a post-rotation epoch. A cold client would have no
  // way back in.
  const parentWrap = input.wraps.find(
    (wrap) =>
      wrap.recipientKind === "container" &&
      wrap.recipientId === parentKek.containerId &&
      wrap.recipientKeyEpochId === input.parentContainerKeyEpochId &&
      (parentKek.keyEpochHash === null ||
        wrap.recipientKeyFingerprint === parentKek.keyEpochHash),
  );
  if (!parentWrap) {
    return null;
  }

  try {
    return await unwrapContainerKekParentWrap({
      parentContainerId: parentKek.containerId,
      parentKeyMaterial: parentKek.keyMaterial,
      kemCipherText: parentWrap.kemCipherText,
      wrappedKey: parentWrap.wrappedKey,
    });
  } catch (error) {
    throw new Error(`${input.label} parent wrap could not be unwrapped`, {
      cause: error,
    });
  }
}

export async function assertSignedWrappingPublicKey(
  projection: ContainerWriterProjectionResponse,
  index: number,
  keyMaterial: Uint8Array,
): Promise<void> {
  const manifest = projection.path[index];
  if (!manifest || !isPlainRecord(manifest.state))
    throw new Error("Container manifest is missing");
  const containerId = readManifestContainerId(manifest);
  if (!containerId) throw new Error("Container manifest ID is missing");
  const publicKey = await deriveContainerKekWrappingPublicKey({
    containerId,
    keyMaterial,
  });
  if (Reflect.get(manifest.state, "containerKeyPublicKey") !== publicKey) {
    throw new Error(
      `${projectionKekLabel(index)} wrapping public key does not match KEK material`,
    );
  }
}
