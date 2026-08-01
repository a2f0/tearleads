import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerKeyEpochs } from "@tearleads/api-shared/schema";
import {
  type ContainerKekPredecessorBridge,
  computeContainerKekMaterialId,
  createContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import {
  type ContainerKekHistoryObservation,
  createContainerWriterProjectionContext,
} from "../writerProjection";
import { loadPredecessorContainerKeks } from "./predecessorKeks";

interface EpochFixture {
  readonly containerId: string;
  readonly id: string;
  readonly keyEpoch: number;
  readonly keyMaterial: Uint8Array;
}

async function epochFixture(
  containerId: string,
  keyEpoch: number,
): Promise<EpochFixture> {
  const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
  return {
    containerId,
    id: await computeContainerKekMaterialId({
      containerId,
      keyEpoch,
      keyMaterial,
    }),
    keyEpoch,
    keyMaterial,
  };
}

async function bridge(
  predecessor: EpochFixture,
  successor: EpochFixture,
): Promise<ContainerKekPredecessorBridge> {
  return createContainerKekPredecessorBridge({
    containerId: successor.containerId,
    predecessorContainerKey: predecessor.keyMaterial,
    predecessorContainerKeyEpochId: predecessor.id,
    successorContainerKey: successor.keyMaterial,
    successorContainerKeyEpochId: successor.id,
  });
}

async function insertEpoch(
  epoch: EpochFixture,
  predecessorBridge: ContainerKekPredecessorBridge | null,
): Promise<void> {
  const accessManifestHash = epoch.keyEpoch.toString(16).padStart(64, "0");
  const eventHash = (epoch.keyEpoch + 100).toString(16).padStart(64, "0");
  await db.insert(containerKeyEpochs).values({
    id: epoch.id,
    containerId: epoch.containerId,
    keyEpoch: epoch.keyEpoch,
    accessManifestHash,
    predecessorContainerKeyEpochId:
      predecessorBridge?.predecessorContainerKeyEpochId ?? null,
    predecessorBridgeIv: predecessorBridge?.iv ?? null,
    wrappedPredecessorKey: predecessorBridge?.wrappedKey ?? null,
    createdByEventHash: eventHash,
    createdByManifestHash: accessManifestHash,
  });
}

test("predecessor projection stops before a malformed stored bridge", async () => {
  const containerId = crypto.randomUUID();
  const predecessor = await epochFixture(containerId, 1);
  const successor = await epochFixture(containerId, 2);
  const predecessorBridge = await bridge(predecessor, successor);
  await insertEpoch(predecessor, null);
  await insertEpoch(successor, { ...predecessorBridge, iv: "not-base64" });
  const observations: ContainerKekHistoryObservation[] = [];

  await expect(
    loadPredecessorContainerKeks({
      containerKeyEpochId: successor.id,
      context: createContainerWriterProjectionContext(db, {
        observeContainerKekHistory: (observation) =>
          observations.push(observation),
      }),
    }),
  ).resolves.toEqual([]);
  expect(observations).toEqual([
    expect.objectContaining({
      degradationReason: "malformed_bridge",
      predecessorCount: 0,
      storedEpochCount: 2,
    }),
  ]);
});

test("predecessor projection observes healthy chain length", async () => {
  const containerId = crypto.randomUUID();
  const predecessor = await epochFixture(containerId, 1);
  const successor = await epochFixture(containerId, 2);
  await insertEpoch(predecessor, null);
  await insertEpoch(successor, await bridge(predecessor, successor));
  const observations: ContainerKekHistoryObservation[] = [];

  await expect(
    loadPredecessorContainerKeks({
      containerKeyEpochId: successor.id,
      context: createContainerWriterProjectionContext(db, {
        observeContainerKekHistory: (observation) =>
          observations.push(observation),
      }),
    }),
  ).resolves.toEqual([
    expect.objectContaining({ containerKeyEpochId: predecessor.id }),
  ]);
  expect(observations).toEqual([
    expect.objectContaining({
      degradationReason: null,
      predecessorCount: 1,
      storedEpochCount: 2,
    }),
  ]);
});

test("predecessor projection returns the prefix before a cycle", async () => {
  const containerId = crypto.randomUUID();
  const second = await epochFixture(containerId, 2);
  const third = await epochFixture(containerId, 3);
  await insertEpoch(second, await bridge(third, second));
  await insertEpoch(third, await bridge(second, third));

  await expect(
    loadPredecessorContainerKeks({
      containerKeyEpochId: third.id,
      context: createContainerWriterProjectionContext(db),
    }),
  ).resolves.toEqual([
    expect.objectContaining({ containerKeyEpochId: second.id }),
  ]);
});

test("predecessor projection stops before a missing epoch", async () => {
  const containerId = crypto.randomUUID();
  const predecessor = await epochFixture(containerId, 1);
  const successor = await epochFixture(containerId, 2);
  await insertEpoch(successor, await bridge(predecessor, successor));

  await expect(
    loadPredecessorContainerKeks({
      containerKeyEpochId: successor.id,
      context: createContainerWriterProjectionContext(db),
    }),
  ).resolves.toEqual([]);
});

test("predecessor projection returns the maximal prefix before a missing bridge", async () => {
  const containerId = crypto.randomUUID();
  const second = await epochFixture(containerId, 2);
  const third = await epochFixture(containerId, 3);
  await insertEpoch(second, null);
  await insertEpoch(third, await bridge(second, third));
  const observations: ContainerKekHistoryObservation[] = [];

  await expect(
    loadPredecessorContainerKeks({
      containerKeyEpochId: third.id,
      context: createContainerWriterProjectionContext(db, {
        observeContainerKekHistory: (observation) =>
          observations.push(observation),
      }),
    }),
  ).resolves.toEqual([
    expect.objectContaining({ containerKeyEpochId: second.id }),
  ]);
  expect(observations).toEqual([
    expect.objectContaining({
      degradationReason: "missing_bridge",
      predecessorCount: 1,
      storedEpochCount: 2,
    }),
  ]);
});
