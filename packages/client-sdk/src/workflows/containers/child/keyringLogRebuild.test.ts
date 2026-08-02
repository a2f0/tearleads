import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  createContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import { rebuildKeyringEntriesFromLog } from "../../../data/documents/shared/keyringRebuild";

test("a severed middle bridge rebuilds both segments around the gap", async () => {
  const containerId = crypto.randomUUID();
  // Four epochs; the bridge from 3 -> 2 is destroyed. The walk must still
  // recover epoch 3 from the intact top bridge, and epochs 1-2 once the
  // caller supplies a wrap-recovered anchor for epoch 2.
  const keys = await Promise.all(
    [1, 2, 3, 4].map(async (keyEpoch) => {
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

  const log = {
    containerId,
    hasMore: false,
    epochs: await Promise.all(
      keys.map(async (key, index) => ({
        accessManifestHash: `manifest-${key.keyEpoch}`,
        // Epoch 3's bridge (index 2) is severed.
        bridge:
          index === 0 || index === 2
            ? null
            : ((await bridgeFor(index)) as unknown as Record<string, unknown>),
        containerKeyEpoch: key.keyEpoch,
        containerKeyEpochId: key.containerKeyEpochId,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      })),
    ),
  };

  const withoutAnchor = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: keys[3]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[3]?.containerKeyEpochId as string,
    log,
  });
  // The top segment survives; the gap and everything below it is reported.
  expect(withoutAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    keys[2]?.containerKeyEpochId as string,
  ]);
  expect(withoutAnchor.missingEpochIds).toEqual([
    keys[0]?.containerKeyEpochId as string,
    keys[1]?.containerKeyEpochId as string,
  ]);

  // Supplying the wrap-recovered epoch-2 key re-anchors the lower segment.
  const withAnchor = await rebuildKeyringEntriesFromLog({
    anchorKeysByEpochId: new Map([
      [
        keys[1]?.containerKeyEpochId as string,
        keys[1]?.keyMaterial as Uint8Array,
      ],
    ]),
    containerId,
    currentContainerKey: keys[3]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[3]?.containerKeyEpochId as string,
    log,
  });
  expect(withAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    keys[0]?.containerKeyEpochId as string,
    keys[1]?.containerKeyEpochId as string,
    keys[2]?.containerKeyEpochId as string,
  ]);
  expect(withAnchor.missingEpochIds).toEqual([]);
});

test("a poisoned bridge is treated as severance, not a fatal error", async () => {
  const containerId = crypto.randomUUID();
  const keys = await Promise.all(
    [1, 2].map(async (keyEpoch) => {
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

  // A structurally present but undecryptable bridge: the poisoned-link case
  // the wrap anchors exist for. It must degrade to a reported gap, not an
  // exception that discards the anchor path.
  const poisonedLog = {
    containerId,
    hasMore: false,
    epochs: [
      {
        accessManifestHash: "manifest-1",
        bridge: null,
        containerKeyEpoch: 1,
        containerKeyEpochId: keys[0]?.containerKeyEpochId as string,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      },
      {
        accessManifestHash: "manifest-2",
        bridge: { version: 1, wrappingSuite: "nonsense" } as Record<
          string,
          unknown
        >,
        containerKeyEpoch: 2,
        containerKeyEpochId: keys[1]?.containerKeyEpochId as string,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      },
    ],
  };

  const withoutAnchor = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: keys[1]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[1]?.containerKeyEpochId as string,
    log: poisonedLog,
  });
  expect(withoutAnchor.entries).toEqual([]);
  expect(withoutAnchor.missingEpochIds).toEqual([
    keys[0]?.containerKeyEpochId as string,
  ]);

  // The anchor recovers what the poisoned bridge could not.
  const withAnchor = await rebuildKeyringEntriesFromLog({
    anchorKeysByEpochId: new Map([
      [
        keys[0]?.containerKeyEpochId as string,
        keys[0]?.keyMaterial as Uint8Array,
      ],
    ]),
    containerId,
    currentContainerKey: keys[1]?.keyMaterial as Uint8Array,
    currentContainerKeyEpochId: keys[1]?.containerKeyEpochId as string,
    log: poisonedLog,
  });
  expect(withAnchor.entries.map((e) => e.containerKeyEpochId)).toEqual([
    keys[0]?.containerKeyEpochId as string,
  ]);
  expect(withAnchor.missingEpochIds).toEqual([]);
});
