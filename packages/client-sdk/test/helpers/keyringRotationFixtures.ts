import {
  type ContainerKekKeyring,
  type ContainerKekKeyringEntry,
  computeContainerKekMaterialId,
  computeContainerKeyEpochHash,
  sealContainerKekKeyring,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { readContainerKeyEpoch } from "../../src/data/keyingProjectionVerification/readers";
import {
  createUserContainerWrap,
  createWrappedProjection,
} from "./documentFixtures";

type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];

export interface KeyringRotationFixture {
  /** Child of the root, pinned to root epoch 1 via its parent wrap. */
  childKek: ProjectionKek;
  currentEpochId: string;
  currentKey: Uint8Array;
  currentManifest: ContainerWriterProjectionResponse["path"][number];
  /** Epoch key material in ascending epoch order (index i is epoch i + 1). */
  epochKeys: Uint8Array[];
  /** Epoch ids in ascending epoch order (index i is epoch i + 1). */
  epochIds: string[];
  fixture: Awaited<ReturnType<typeof createWrappedProjection>>;
  /** The current epoch's sealed keyring (all predecessor keys). */
  keyring: ContainerKekKeyring;
  predecessorEpochId: string;
  predecessorKeyEpochHash: string;
  /** The root container KEK entry after rotation to the final epoch. */
  successor: ProjectionKek;
}

/**
 * Rotates the root container of `createWrappedProjection` `rotations` times.
 * Every rotation seals ALL predecessor keys (epochs 1..n-1, ascending) under
 * the new epoch's KEK, exactly as the production rotation flows do, and the
 * final epoch ships the epoch-1 historical record plus a manifest-history
 * bundle pinning the epoch-1 id so history failures stay attributable.
 */
export async function rotateRootKekKeyringFixture(
  rotations = 1,
): Promise<KeyringRotationFixture> {
  const fixture = await createWrappedProjection();
  const rootKek = fixture.projection.containerKeks[0];
  const childKek = fixture.projection.containerKeks[1];
  const rootManifest = fixture.projection.path[0];
  if (!rootKek || !childKek || !rootManifest) {
    throw new Error("Expected root and child container KEK fixtures");
  }
  const predecessorKeyEpoch = readContainerKeyEpoch(
    rootKek.keyEpoch,
    "predecessor key epoch",
  );
  const predecessorKeyEpochHash =
    await computeContainerKeyEpochHash(predecessorKeyEpoch);

  const finalEpoch = rotations + 1;
  const entries: ContainerKekKeyringEntry[] = [];
  const epochIds = [rootKek.containerKeyEpochId];
  const epochKeys = [fixture.rootContainerKek];
  let currentEpochId = rootKek.containerKeyEpochId;
  let currentKey = fixture.rootContainerKek;
  let keyring: ContainerKekKeyring | null = null;
  for (let keyEpoch = 2; keyEpoch <= finalEpoch; keyEpoch += 1) {
    entries.push({
      containerKeyEpochId: currentEpochId,
      keyMaterial: currentKey,
    });
    const successorKey = crypto.getRandomValues(new Uint8Array(32));
    const successorEpochId = await computeContainerKekMaterialId({
      containerId: rootKek.containerId,
      keyEpoch,
      keyMaterial: successorKey,
    });
    keyring = await sealContainerKekKeyring({
      containerId: rootKek.containerId,
      entries,
      keyEpoch,
      successorContainerKey: successorKey,
      successorContainerKeyEpochId: successorEpochId,
    });
    currentEpochId = successorEpochId;
    currentKey = successorKey;
    epochIds.push(successorEpochId);
    epochKeys.push(successorKey);
  }
  if (!keyring) {
    throw new Error("Expected at least one KEK rotation");
  }

  const successorKeyEpoch = {
    ...predecessorKeyEpoch,
    id: currentEpochId,
    keyEpoch: finalEpoch,
  };
  const successor: ProjectionKek = {
    ...rootKek,
    containerKeyEpoch: finalEpoch,
    containerKeyEpochId: currentEpochId,
    keyEpoch: successorKeyEpoch as unknown as Record<string, unknown>,
    keyEpochHash: await computeContainerKeyEpochHash(successorKeyEpoch),
    containerManifestHistory: [
      {
        ...rootManifest,
        state: {
          ...rootManifest.state,
          containerKeyEpochId: rootKek.containerKeyEpochId,
        },
      },
    ],
    keyring,
    wraps: [
      await createUserContainerWrap({
        containerKeyEpochId: currentEpochId,
        containerKek: currentKey,
        publicKey: fixture.publicKey,
        userId: "user-1",
        wrapManifestHash: rootKek.accessManifestHash,
      }),
    ],
  };

  return {
    childKek: {
      ...childKek,
      wraps: childKek.wraps.map((wrap) => ({
        ...wrap,
        recipientKeyFingerprint: predecessorKeyEpochHash,
      })),
    },
    currentEpochId,
    currentKey,
    currentManifest: rootManifest,
    epochIds,
    epochKeys,
    fixture,
    keyring,
    predecessorEpochId: rootKek.containerKeyEpochId,
    predecessorKeyEpochHash,
    successor,
  };
}

/** Flips one sealed byte so the keyring fails AEAD verification on open. */
export function tamperSealedKeyring<T extends { sealed: string }>(
  keyring: T,
): T {
  const sealed = base64ToBytes(keyring.sealed);
  sealed[8] = (sealed[8] ?? 0) ^ 0xff;
  return { ...keyring, sealed: bytesToBase64(sealed) };
}
