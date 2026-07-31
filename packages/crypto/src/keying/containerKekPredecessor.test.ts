import { expect, test } from "bun:test";
import { computeContainerKekMaterialId } from "./containerKekMaterial";
import {
  computeContainerKekPredecessorBridgeHash,
  createContainerKekPredecessorBridge,
  normalizeContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
} from "./containerKekPredecessor";

async function epochId(
  containerId: string,
  keyEpoch: number,
  keyMaterial: Uint8Array,
) {
  return computeContainerKekMaterialId({
    containerId,
    keyEpoch,
    keyMaterial,
  });
}

test("a successor container KEK unwraps its authenticated predecessor", async () => {
  const containerId = crypto.randomUUID();
  const predecessorContainerKey = crypto.getRandomValues(new Uint8Array(32));
  const successorContainerKey = crypto.getRandomValues(new Uint8Array(32));
  const bridge = await createContainerKekPredecessorBridge({
    containerId,
    predecessorContainerKey,
    predecessorContainerKeyEpochId: await epochId(
      containerId,
      1,
      predecessorContainerKey,
    ),
    successorContainerKey,
    successorContainerKeyEpochId: await epochId(
      containerId,
      2,
      successorContainerKey,
    ),
  });

  expect(
    await unwrapContainerKekPredecessorBridge({
      bridge,
      successorContainerKey,
    }),
  ).toEqual(predecessorContainerKey);
  await expect(
    unwrapContainerKekPredecessorBridge({
      bridge,
      successorContainerKey: predecessorContainerKey,
    }),
  ).rejects.toThrow();
});

test("predecessor bridge metadata is authenticated", async () => {
  const containerId = crypto.randomUUID();
  const predecessorContainerKey = crypto.getRandomValues(new Uint8Array(32));
  const successorContainerKey = crypto.getRandomValues(new Uint8Array(32));
  const bridge = await createContainerKekPredecessorBridge({
    containerId,
    predecessorContainerKey,
    predecessorContainerKeyEpochId: await epochId(
      containerId,
      1,
      predecessorContainerKey,
    ),
    successorContainerKey,
    successorContainerKeyEpochId: await epochId(
      containerId,
      2,
      successorContainerKey,
    ),
  });

  await expect(
    unwrapContainerKekPredecessorBridge({
      bridge: { ...bridge, containerId: crypto.randomUUID() },
      successorContainerKey,
    }),
  ).rejects.toThrow();
  expect(() =>
    normalizeContainerKekPredecessorBridge({
      ...bridge,
      wrappedKey: "not-base64",
    }),
  ).toThrow();
  await expect(
    createContainerKekPredecessorBridge({
      containerId,
      predecessorContainerKey,
      predecessorContainerKeyEpochId: bridge.predecessorContainerKeyEpochId,
      successorContainerKey,
      successorContainerKeyEpochId: bridge.predecessorContainerKeyEpochId,
    }),
  ).rejects.toThrow("must connect distinct epochs");
  await expect(
    createContainerKekPredecessorBridge({
      containerId,
      predecessorContainerKey: new Uint8Array(31),
      predecessorContainerKeyEpochId: bridge.predecessorContainerKeyEpochId,
      successorContainerKey,
      successorContainerKeyEpochId: bridge.successorContainerKeyEpochId,
    }),
  ).rejects.toThrow("keys must be 32 bytes");
  expect(await computeContainerKekPredecessorBridgeHash(bridge)).not.toBe(
    await computeContainerKekPredecessorBridgeHash({
      ...bridge,
      iv: bridge.iv.replace(/^./, bridge.iv.startsWith("A") ? "B" : "A"),
    }),
  );
});
