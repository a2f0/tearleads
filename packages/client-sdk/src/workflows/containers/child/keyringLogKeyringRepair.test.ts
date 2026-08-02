import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  createContainerKekPredecessorBridge,
  sealContainerKekKeyring,
} from "@tearleads/crypto";
import { rebuildKeyringEntriesFromLog } from "../../../data/documents/shared/keyringRebuild";

test("a served keyring recovers across two severed bridges at once", async () => {
  const containerId = crypto.randomUUID();
  // Five epochs with BOTH the 3 -> 2 and 2 -> 1 bridges destroyed. A bridge
  // walk alone cannot cross two gaps: one anchor only re-anchors one segment.
  // The keyring sealed at the head epoch carries every epoch beneath it, so a
  // single decrypt recovers the whole history regardless of how many links
  // below it were severed.
  const keys = await Promise.all(
    [1, 2, 3, 4, 5].map(async (keyEpoch) => {
      const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
      return {
        containerKeyEpochId: await computeContainerKekMaterialId({
          containerId,
          keyEpoch,
          keyMaterial,
        }),
        keyEpoch,
        keyMaterial,
      };
    }),
  );
  const head = keys.at(-1);
  if (!head) throw new Error("expected a head epoch");

  const bridgeFor = async (successorIndex: number) =>
    createContainerKekPredecessorBridge({
      containerId,
      predecessorContainerKey: keys[successorIndex - 1]
        ?.keyMaterial as Uint8Array,
      predecessorContainerKeyEpochId: keys[successorIndex - 1]
        ?.containerKeyEpochId as string,
      successorContainerKey: keys[successorIndex]?.keyMaterial as Uint8Array,
      successorContainerKeyEpochId: keys[successorIndex]
        ?.containerKeyEpochId as string,
    });

  const sealedKeyring = await sealContainerKekKeyring({
    containerId,
    entries: keys.slice(0, -1).map((key) => ({
      containerKeyEpochId: key.containerKeyEpochId,
      keyMaterial: key.keyMaterial,
    })),
    keyEpoch: head.keyEpoch,
    successorContainerKey: head.keyMaterial,
    successorContainerKeyEpochId: head.containerKeyEpochId,
  });

  const buildLog = (withKeyring: boolean) => ({
    containerId,
    epochs: keys.map((key, index) => ({
      accessManifestHash: `manifest-${key.keyEpoch}`,
      // Both the 2 -> 1 (index 1) and 3 -> 2 (index 2) bridges are severed.
      bridge:
        index === 0 || index === 1 || index === 2
          ? null
          : (bridges[index] as unknown as Record<string, unknown>),
      containerKeyEpoch: key.keyEpoch,
      containerKeyEpochId: key.containerKeyEpochId,
      keyring:
        withKeyring && index === keys.length - 1
          ? (sealedKeyring as unknown as never)
          : null,
      parentContainerKeyEpochId: null,
      wraps: [],
    })),
  });

  const bridges = await Promise.all(
    keys.map(async (_key, index) => (index === 0 ? null : bridgeFor(index))),
  );

  // Without the keyring the two gaps strand epochs 1 and 2.
  const walkOnly = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: head.keyMaterial,
    currentContainerKeyEpochId: head.containerKeyEpochId,
    log: buildLog(false),
  });
  expect(walkOnly.missingEpochIds.length).toBeGreaterThan(0);

  // With it, every epoch below the head is recovered in one decrypt.
  const withKeyring = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: head.keyMaterial,
    currentContainerKeyEpochId: head.containerKeyEpochId,
    log: buildLog(true),
  });
  expect(withKeyring.missingEpochIds).toEqual([]);
  expect(withKeyring.entries.map((entry) => entry.containerKeyEpochId)).toEqual(
    keys.slice(0, -1).map((key) => key.containerKeyEpochId),
  );
}, 20_000);

test("a keyring below an intact prefix repairs the gaps beneath it", async () => {
  // Six epochs. The top two bridges are intact, so the walk descends to epoch
  // 4 on its own. Below that, BOTH the 3 -> 2 and 2 -> 1 bridges are severed,
  // and the keyring that could repair them is sealed at epoch 4 — not at the
  // head. It is only openable once the walk has already reached epoch 4, so a
  // one-shot pre-pass under the current key would never open it.
  const containerId = crypto.randomUUID();
  const keys = await Promise.all(
    [1, 2, 3, 4, 5, 6].map(async (keyEpoch) => {
      const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
      return {
        containerKeyEpochId: await computeContainerKekMaterialId({
          containerId,
          keyEpoch,
          keyMaterial,
        }),
        keyEpoch,
        keyMaterial,
      };
    }),
  );
  const head = keys.at(-1);
  const midpoint = keys[3];
  if (!head || !midpoint) throw new Error("expected fixture epochs");

  const bridges = await Promise.all(
    keys.map(async (_key, index) =>
      index === 0
        ? null
        : createContainerKekPredecessorBridge({
            containerId,
            predecessorContainerKey: keys[index - 1]?.keyMaterial as Uint8Array,
            predecessorContainerKeyEpochId: keys[index - 1]
              ?.containerKeyEpochId as string,
            successorContainerKey: keys[index]?.keyMaterial as Uint8Array,
            successorContainerKeyEpochId: keys[index]
              ?.containerKeyEpochId as string,
          }),
    ),
  );

  // The keyring at epoch 4 seals epochs 1-3.
  const midpointKeyring = await sealContainerKekKeyring({
    containerId,
    entries: keys.slice(0, 3).map((key) => ({
      containerKeyEpochId: key.containerKeyEpochId,
      keyMaterial: key.keyMaterial,
    })),
    keyEpoch: midpoint.keyEpoch,
    successorContainerKey: midpoint.keyMaterial,
    successorContainerKeyEpochId: midpoint.containerKeyEpochId,
  });

  const rebuilt = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: head.keyMaterial,
    currentContainerKeyEpochId: head.containerKeyEpochId,
    log: {
      containerId,
      epochs: keys.map((key, index) => ({
        accessManifestHash: `manifest-${key.keyEpoch}`,
        // Bridges into epochs 2 and 3 are severed; 5 and 6 are intact.
        bridge:
          index === 0 || index === 1 || index === 2
            ? null
            : (bridges[index] as unknown as Record<string, unknown>),
        containerKeyEpoch: key.keyEpoch,
        containerKeyEpochId: key.containerKeyEpochId,
        keyring: index === 3 ? (midpointKeyring as unknown as never) : null,
        parentContainerKeyEpochId: null,
        wraps: [],
      })),
    },
  });

  expect(rebuilt.missingEpochIds).toEqual([]);
  expect(rebuilt.entries.map((entry) => entry.containerKeyEpochId)).toEqual(
    keys.slice(0, -1).map((key) => key.containerKeyEpochId),
  );
}, 20_000);
