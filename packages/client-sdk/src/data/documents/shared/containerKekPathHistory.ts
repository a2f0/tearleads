import {
  computeContainerKekMaterialId,
  computeContainerKekPredecessorBridgeHash,
  computeContainerKeyEpochHash,
  isContainerKekMaterialId,
  normalizeContainerAccessEventBody,
  normalizeContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../keyingCanonicalJson";
import { readContainerKeyEpoch } from "../../keyingProjectionVerification/readers";
import { readManifestContainerId, readRecordNullableString } from "./readers";
import type { UnwrappedContainerKek } from "./types";

export function projectionKekLabel(index: number): string {
  return `Container writer projection KEK[${index}]`;
}

export async function assertUnwrappedContainerKekMatchesMaterialId(input: {
  label: string;
  keyMaterial: Uint8Array;
  kek: Pick<
    ContainerWriterProjectionResponse["containerKeks"][number],
    "containerId" | "containerKeyEpoch" | "containerKeyEpochId"
  >;
}): Promise<void> {
  if (!isContainerKekMaterialId(input.kek.containerKeyEpochId)) {
    throw new Error(
      `${input.label} KEK epoch id does not commit to key material`,
    );
  }
  const expectedId = await computeContainerKekMaterialId({
    containerId: input.kek.containerId,
    keyEpoch: input.kek.containerKeyEpoch,
    keyMaterial: input.keyMaterial,
  });
  if (expectedId !== input.kek.containerKeyEpochId) {
    throw new Error(
      `${input.label} KEK material does not match committed epoch id`,
    );
  }
}

function cachedPredecessorKey(input: {
  cached: UnwrappedContainerKek | undefined;
  index: number;
  predecessor: ContainerWriterProjectionResponse["containerKeks"][number]["predecessorKeks"][number];
}): Uint8Array | null {
  if (!input.cached) {
    return null;
  }
  if (
    input.cached.containerId !== input.predecessor.containerId ||
    input.cached.keyEpochHash !== input.predecessor.keyEpochHash
  ) {
    throw new Error(
      `${projectionKekLabel(input.index)} cached predecessor is inconsistent`,
    );
  }
  return input.cached.keyMaterial;
}

async function unwrapPredecessorBridge(input: {
  bridge: ReturnType<typeof normalizeContainerKekPredecessorBridge>;
  index: number;
  successorKeyMaterial: Uint8Array;
}): Promise<Uint8Array> {
  try {
    return await unwrapContainerKekPredecessorBridge({
      bridge: input.bridge,
      successorContainerKey: input.successorKeyMaterial,
    });
  } catch (error) {
    throw new Error(
      `${projectionKekLabel(input.index)} predecessor bridge could not be unwrapped`,
      { cause: error },
    );
  }
}

async function assertPredecessorEpoch(input: {
  index: number;
  kek: ContainerWriterProjectionResponse["containerKeks"][number];
  predecessor: ContainerWriterProjectionResponse["containerKeks"][number]["predecessorKeks"][number];
  successorEpoch: number;
  verifiedManifestHashes: ReadonlySet<string>;
}): Promise<void> {
  if (
    input.predecessor.containerId !== input.kek.containerId ||
    input.predecessor.containerKeyEpoch !== input.successorEpoch - 1 ||
    !input.verifiedManifestHashes.has(input.predecessor.accessManifestHash)
  ) {
    throw new Error(
      `${projectionKekLabel(input.index)} predecessor epoch is inconsistent`,
    );
  }
  const keyEpoch = readContainerKeyEpoch(
    input.predecessor.keyEpoch,
    `${projectionKekLabel(input.index)} predecessor key epoch`,
  );
  if (
    keyEpoch.id !== input.predecessor.containerKeyEpochId ||
    keyEpoch.containerId !== input.predecessor.containerId ||
    keyEpoch.keyEpoch !== input.predecessor.containerKeyEpoch ||
    keyEpoch.accessManifestHash !== input.predecessor.accessManifestHash ||
    keyEpoch.parentContainerKeyEpochId !==
      input.predecessor.parentContainerKeyEpochId ||
    (await computeContainerKeyEpochHash(keyEpoch)) !==
      input.predecessor.keyEpochHash
  ) {
    throw new Error(
      `${projectionKekLabel(input.index)} predecessor key epoch is invalid`,
    );
  }
}

function sameContainerManifestHistory(
  kek: ContainerWriterProjectionResponse["containerKeks"][number],
) {
  return kek.containerManifestHistory.filter(
    (bundle) => readManifestContainerId(bundle) === kek.containerId,
  );
}

export async function unwrapPredecessorContainerKeksAtIndex(input: {
  currentManifest: ContainerWriterProjectionResponse["path"][number];
  index: number;
  kek: ContainerWriterProjectionResponse["containerKeks"][number];
  keksByEpochId: Map<string, UnwrappedContainerKek>;
  successorKeyMaterial: Uint8Array | null;
  verifyBridgeCommitment: boolean;
}): Promise<void> {
  if (!input.successorKeyMaterial) {
    return;
  }

  let successorEpochId = input.kek.containerKeyEpochId;
  let successorEpoch = input.kek.containerKeyEpoch;
  let successorManifestHash = readContainerKeyEpoch(
    input.kek.keyEpoch,
    `${projectionKekLabel(input.index)} key epoch`,
  ).accessManifestHash;
  let successorKeyMaterial = input.successorKeyMaterial;
  const verifiedManifestHashes = new Set([
    input.kek.accessManifestHash,
    ...sameContainerManifestHistory(input.kek).map(
      (bundle) => bundle.manifestHash,
    ),
  ]);
  for (const predecessor of input.kek.predecessorKeks) {
    await assertPredecessorEpoch({
      index: input.index,
      kek: input.kek,
      predecessor,
      successorEpoch,
      verifiedManifestHashes,
    });

    const bridge = normalizeContainerKekPredecessorBridge(predecessor.bridge);
    if (
      bridge.containerId !== input.kek.containerId ||
      bridge.successorContainerKeyEpochId !== successorEpochId ||
      bridge.predecessorContainerKeyEpochId !== predecessor.containerKeyEpochId
    ) {
      throw new Error(
        `${projectionKekLabel(input.index)} predecessor bridge is inconsistent`,
      );
    }
    if (input.verifyBridgeCommitment) {
      await assertPredecessorBridgeCommitment({
        bridge,
        currentManifest: input.currentManifest,
        index: input.index,
        kek: input.kek,
        successorManifestHash,
      });
    }

    const cachedKey = cachedPredecessorKey({
      cached: input.keksByEpochId.get(predecessor.containerKeyEpochId),
      index: input.index,
      predecessor,
    });
    const predecessorKeyMaterial =
      cachedKey ??
      (await unwrapPredecessorBridge({
        bridge,
        index: input.index,
        successorKeyMaterial,
      }));
    if (!cachedKey) {
      await assertUnwrappedContainerKekMatchesMaterialId({
        label: `${projectionKekLabel(input.index)} predecessor ${predecessor.containerKeyEpochId}`,
        kek: predecessor,
        keyMaterial: predecessorKeyMaterial,
      });
      input.keksByEpochId.set(predecessor.containerKeyEpochId, {
        containerId: predecessor.containerId,
        keyEpochHash: predecessor.keyEpochHash,
        keyMaterial: predecessorKeyMaterial,
      });
    }
    successorEpochId = predecessor.containerKeyEpochId;
    successorEpoch = predecessor.containerKeyEpoch;
    successorManifestHash = predecessor.accessManifestHash;
    successorKeyMaterial = predecessorKeyMaterial;
  }
  if (successorEpoch !== 1) {
    throw new Error(
      `${projectionKekLabel(input.index)} predecessor chain is incomplete`,
    );
  }
}

export function projectedUnreachablePredecessorEpochIds(input: {
  kek: ContainerWriterProjectionResponse["containerKeks"][number];
  keksByEpochId: ReadonlyMap<string, UnwrappedContainerKek>;
}): string[] {
  const projectedEpochIds = new Set(
    input.kek.predecessorKeks.map(
      (predecessor) => predecessor.containerKeyEpochId,
    ),
  );
  for (const bundle of sameContainerManifestHistory(input.kek)) {
    const state = readCanonicalRecord(
      bundle.state,
      "Container writer projection historical manifest state",
    );
    const containerKeyEpochId = readRecordNullableString(
      state,
      "containerKeyEpochId",
      "Container writer projection historical manifest state",
    );
    if (containerKeyEpochId !== null) {
      projectedEpochIds.add(containerKeyEpochId);
    }
  }
  projectedEpochIds.delete(input.kek.containerKeyEpochId);
  return [...projectedEpochIds].filter(
    (containerKeyEpochId) => !input.keksByEpochId.has(containerKeyEpochId),
  );
}

async function assertPredecessorBridgeCommitment(input: {
  bridge: ReturnType<typeof normalizeContainerKekPredecessorBridge>;
  currentManifest: ContainerWriterProjectionResponse["path"][number];
  index: number;
  kek: ContainerWriterProjectionResponse["containerKeks"][number];
  successorManifestHash: string;
}): Promise<void> {
  const successorManifest =
    input.successorManifestHash === input.currentManifest.manifestHash
      ? input.currentManifest
      : sameContainerManifestHistory(input.kek).find(
          (bundle) => bundle.manifestHash === input.successorManifestHash,
        );
  if (!successorManifest) {
    throw new Error(
      `${projectionKekLabel(input.index)} predecessor bridge signer is missing`,
    );
  }
  const eventBundle = readCanonicalRecord(
    successorManifest.event,
    `${projectionKekLabel(input.index)} predecessor bridge event`,
  );
  const eventBody = normalizeContainerAccessEventBody(
    readCanonicalJson(
      Reflect.get(eventBundle, "body"),
      `${projectionKekLabel(input.index)} predecessor bridge event body`,
    ),
  );
  if (
    (eventBody.eventType !== "container.move" &&
      eventBody.eventType !== "container.rekey" &&
      eventBody.eventType !== "container.revoke") ||
    eventBody.predecessorBridgeHash !==
      (await computeContainerKekPredecessorBridgeHash(input.bridge))
  ) {
    throw new Error(
      `${projectionKekLabel(input.index)} predecessor bridge does not match its signed event`,
    );
  }
}
