import {
  computeContainerKekKeyringHash,
  computeContainerKekMaterialId,
  computeContainerKeyEpochHash,
  isContainerKekMaterialId,
  KeyingVerificationError,
  normalizeContainerAccessEventBody,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  verifyContainerKekKeyringEntry,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../keyingCanonicalJson";
import { readContainerKeyEpoch } from "../../keyingProjectionVerification/readers";
import { readManifestContainerId } from "./readers";
import type { UnwrappedContainerKek } from "./types";

type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];
type HistoricalKeyEpoch = ProjectionKek["historicalKeyEpochs"][number];

export function projectionKekLabel(index: number): string {
  return `Container writer projection KEK[${index}]`;
}

export async function assertUnwrappedContainerKekMatchesMaterialId(input: {
  label: string;
  keyMaterial: Uint8Array;
  kek: Pick<
    ProjectionKek,
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

function sameContainerManifestHistory(kek: ProjectionKek) {
  return kek.containerManifestHistory.filter(
    (bundle) => readManifestContainerId(bundle) === kek.containerId,
  );
}

/**
 * Verifies a historical epoch record the projection shipped because a
 * descendant pins it as `parentContainerKeyEpochId`: the record must belong
 * to this container, predate the current epoch, anchor to a verified
 * manifest, and hash to its committed record hash.
 */
async function assertHistoricalKeyEpoch(input: {
  index: number;
  kek: ProjectionKek;
  record: HistoricalKeyEpoch;
  verifiedManifestHashes: ReadonlySet<string>;
}): Promise<void> {
  if (
    input.record.containerId !== input.kek.containerId ||
    input.record.containerKeyEpoch >= input.kek.containerKeyEpoch ||
    !input.verifiedManifestHashes.has(input.record.accessManifestHash)
  ) {
    throw new Error(
      `${projectionKekLabel(input.index)} historical epoch is inconsistent`,
    );
  }
  const keyEpoch = readContainerKeyEpoch(
    input.record.keyEpoch,
    `${projectionKekLabel(input.index)} historical key epoch`,
  );
  if (
    keyEpoch.id !== input.record.containerKeyEpochId ||
    keyEpoch.containerId !== input.record.containerId ||
    keyEpoch.keyEpoch !== input.record.containerKeyEpoch ||
    keyEpoch.accessManifestHash !== input.record.accessManifestHash ||
    keyEpoch.parentContainerKeyEpochId !==
      input.record.parentContainerKeyEpochId ||
    (await computeContainerKeyEpochHash(keyEpoch)) !== input.record.keyEpochHash
  ) {
    throw new Error(
      `${projectionKekLabel(input.index)} historical key epoch is invalid`,
    );
  }
}

/**
 * Proves the served keyring is the one the rotation that minted the current
 * epoch committed to in its signed event body.
 */
async function assertKeyringCommitment(input: {
  currentManifest: ContainerWriterProjectionResponse["path"][number];
  index: number;
  kek: ProjectionKek;
  keyring: ReturnType<typeof normalizeContainerKekKeyring>;
}): Promise<void> {
  const rotationManifestHash = readContainerKeyEpoch(
    input.kek.keyEpoch,
    `${projectionKekLabel(input.index)} key epoch`,
  ).accessManifestHash;
  const rotationManifest =
    rotationManifestHash === input.currentManifest.manifestHash
      ? input.currentManifest
      : sameContainerManifestHistory(input.kek).find(
          (bundle) => bundle.manifestHash === rotationManifestHash,
        );
  if (!rotationManifest) {
    throw new Error(
      `${projectionKekLabel(input.index)} keyring signer is missing`,
    );
  }
  const eventBundle = readCanonicalRecord(
    rotationManifest.event,
    `${projectionKekLabel(input.index)} keyring event`,
  );
  const eventBody = normalizeContainerAccessEventBody(
    readCanonicalJson(
      Reflect.get(eventBundle, "body"),
      `${projectionKekLabel(input.index)} keyring event body`,
    ),
  );
  if (
    (eventBody.eventType !== "container.move" &&
      eventBody.eventType !== "container.rekey" &&
      eventBody.eventType !== "container.revoke") ||
    eventBody.keyringHash !==
      (await computeContainerKekKeyringHash(input.keyring))
  ) {
    throw new Error(
      `${projectionKekLabel(input.index)} keyring does not match its signed event`,
    );
  }
}

/**
 * Opens the sealed keyring for one path index and admits every entry into
 * `keksByEpochId` after verifying it against the material-id commitment its
 * ordinal position implies (entry i is key epoch i + 1). No chain walk:
 * one decrypt yields the container's complete retained history, and entry
 * verification is independent per entry.
 */
export async function unwrapKeyringContainerKeksAtIndex(input: {
  currentManifest: ContainerWriterProjectionResponse["path"][number];
  index: number;
  kek: ProjectionKek;
  keksByEpochId: Map<string, UnwrappedContainerKek>;
  successorKeyMaterial: Uint8Array | null;
  verifyKeyringCommitment: boolean;
}): Promise<void> {
  if (!input.successorKeyMaterial) {
    return;
  }
  const { kek } = input;

  if (kek.keyring === null) {
    if (kek.containerKeyEpoch !== 1) {
      throw new Error(`${projectionKekLabel(input.index)} keyring is missing`);
    }
    if (kek.historicalKeyEpochs.length > 0) {
      throw new Error(
        `${projectionKekLabel(input.index)} historical epochs are unreachable`,
      );
    }
    return;
  }

  const keyring = normalizeContainerKekKeyring(kek.keyring);
  if (
    keyring.containerId !== kek.containerId ||
    keyring.containerKeyEpochId !== kek.containerKeyEpochId
  ) {
    throw new Error(
      `${projectionKekLabel(input.index)} keyring is inconsistent`,
    );
  }
  if (input.verifyKeyringCommitment) {
    await assertKeyringCommitment({
      currentManifest: input.currentManifest,
      index: input.index,
      kek,
      keyring,
    });
  }

  let entries: Awaited<ReturnType<typeof openContainerKekKeyring>>;
  try {
    entries = await openContainerKekKeyring({
      keyEpoch: kek.containerKeyEpoch,
      keyring,
      successorContainerKey: input.successorKeyMaterial,
    });
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    // Label opaque AEAD failures; structural verification errors already
    // carry their own diagnosis.
    throw new Error(
      `${projectionKekLabel(input.index)} keyring could not be opened`,
      { cause: error },
    );
  }
  await Promise.all(
    entries.map((entry, ordinal) =>
      verifyContainerKekKeyringEntry({
        containerId: kek.containerId,
        entry,
        keyEpoch: ordinal + 1,
      }),
    ),
  );

  const verifiedManifestHashes = new Set([
    kek.accessManifestHash,
    ...sameContainerManifestHistory(kek).map((bundle) => bundle.manifestHash),
  ]);
  const recordsByEpochId = new Map<string, HistoricalKeyEpoch>();
  const entryEpochIds = new Set(
    entries.map((entry) => entry.containerKeyEpochId),
  );
  for (const record of kek.historicalKeyEpochs) {
    await assertHistoricalKeyEpoch({
      index: input.index,
      kek,
      record,
      verifiedManifestHashes,
    });
    // Checked before any entry is admitted so a projection whose pinned
    // historical record is absent from the keyring fails closed without
    // partially materializing history.
    if (!entryEpochIds.has(record.containerKeyEpochId)) {
      throw new Error(
        `${projectionKekLabel(input.index)} historical epoch is not in the keyring`,
      );
    }
    recordsByEpochId.set(record.containerKeyEpochId, record);
  }

  for (const entry of entries) {
    const record = recordsByEpochId.get(entry.containerKeyEpochId);
    const cached = input.keksByEpochId.get(entry.containerKeyEpochId);
    if (cached) {
      if (
        cached.containerId !== kek.containerId ||
        (cached.keyEpochHash !== null &&
          record &&
          cached.keyEpochHash !== record.keyEpochHash)
      ) {
        throw new Error(
          `${projectionKekLabel(input.index)} cached historical KEK is inconsistent`,
        );
      }
      if (cached.keyEpochHash !== null && !record) {
        continue;
      }
    }
    input.keksByEpochId.set(entry.containerKeyEpochId, {
      containerId: kek.containerId,
      // Parent-wrap matching binds to the epoch record hash, so only epochs
      // whose records shipped can satisfy a pinned parent wrap; every entry
      // still serves content-key unwrapping by epoch id alone.
      keyEpochHash: record ? record.keyEpochHash : null,
      keyMaterial: entry.keyMaterial,
    });
  }
}

/**
 * Epoch ids this projection implies exist but that were not recovered —
 * used to attribute history failures to the material they orphan.
 */
export function projectedUnreachablePredecessorEpochIds(input: {
  kek: ProjectionKek;
  keksByEpochId: ReadonlyMap<string, UnwrappedContainerKek>;
}): string[] {
  const projectedEpochIds = new Set(
    input.kek.historicalKeyEpochs.map((record) => record.containerKeyEpochId),
  );
  for (const bundle of sameContainerManifestHistory(input.kek)) {
    const state = readCanonicalRecord(
      bundle.state,
      "Container writer projection historical manifest state",
    );
    const containerKeyEpochId = Reflect.get(state, "containerKeyEpochId");
    if (typeof containerKeyEpochId === "string") {
      projectedEpochIds.add(containerKeyEpochId);
    }
  }
  projectedEpochIds.delete(input.kek.containerKeyEpochId);
  return [...projectedEpochIds].filter(
    (containerKeyEpochId) => !input.keksByEpochId.has(containerKeyEpochId),
  );
}
