import {
  computeContainerKekKeyringHash,
  computeContainerKekMaterialId,
  isContainerKekMaterialId,
  KeyingVerificationError,
  normalizeContainerAccessEventBody,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  verifyContainerKekKeyringEntry,
} from "@symcrypt/crypto";
import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../keyingCanonicalJson";
import { readContainerKeyEpoch } from "../../keyingProjectionVerification/readers";
import { readManifestContainerId } from "./readers";
import type { UnwrappedContainerKek } from "./types";

type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];

/** The projection proves a predecessor existed, but no retained keyring can recover it. */
export class ContainerKekHistoryUnavailableError extends Error {
  constructor(label: string) {
    super(`${label} keyring is missing`);
    this.name = "ContainerKekHistoryUnavailableError";
  }
}

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

async function openVerifiedKeyringEntries(input: {
  currentManifest: ContainerWriterProjectionResponse["path"][number];
  index: number;
  kek: ProjectionKek;
  successorKeyMaterial: Uint8Array;
  verifyKeyringCommitment: boolean;
}): Promise<Awaited<ReturnType<typeof openContainerKekKeyring>>> {
  const { kek } = input;
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
  // Per-entry material-id verification proves an entry's key matches the id
  // it declares, but a poisoned keyring can declare a self-consistent FAKE
  // id — fresh key, matching commitment — for an epoch the container never
  // had. Anchor every entry the projection can name to the epoch id its
  // signed history actually committed; anything else is a forged epoch.
  await Promise.all(
    entries.map((entry, ordinal) =>
      verifyContainerKekKeyringEntry({
        containerId: kek.containerId,
        entry,
        keyEpoch: ordinal + 1,
      }),
    ),
  );

  // Every epoch id the signed manifest history names must be present in the
  // keyring. A forged entry can be self-consistent, but it cannot also make
  // the real epoch id — which a signed state already named — disappear.
  const entryEpochIds = new Set(
    entries.map((entry) => entry.containerKeyEpochId),
  );
  for (const historicalEpochId of manifestHistoryEpochIds(kek)) {
    if (!entryEpochIds.has(historicalEpochId)) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `${projectionKekLabel(input.index)} keyring omits an epoch its manifest history commits to`,
      );
    }
  }
  return entries;
}

/**
 * Epoch ids named by verified historical manifest states for this container.
 * Those states are signed, so an id they name is an epoch the container
 * provably had — and a keyring that omits it in favor of a forged id for the
 * same position is detectable even when no epoch RECORD was shipped.
 */
export function manifestHistoryEpochIds(kek: ProjectionKek): Set<string> {
  const epochIds = new Set<string>();
  for (const bundle of sameContainerManifestHistory(kek)) {
    const state = readCanonicalRecord(
      bundle.state,
      "Container writer projection historical manifest state",
    );
    const containerKeyEpochId = Reflect.get(state, "containerKeyEpochId");
    if (
      typeof containerKeyEpochId === "string" &&
      containerKeyEpochId !== kek.containerKeyEpochId
    ) {
      epochIds.add(containerKeyEpochId);
    }
  }
  return epochIds;
}

function admitKeyringEntry(input: {
  entry: Awaited<ReturnType<typeof openContainerKekKeyring>>[number];
  index: number;
  kek: ProjectionKek;
  keksByEpochId: Map<string, UnwrappedContainerKek>;
}): void {
  const { entry, kek } = input;
  const cached = input.keksByEpochId.get(entry.containerKeyEpochId);
  if (cached) {
    if (cached.containerId !== kek.containerId) {
      throw new Error(
        `${projectionKekLabel(input.index)} cached historical KEK is inconsistent`,
      );
    }
    return;
  }
  input.keksByEpochId.set(entry.containerKeyEpochId, {
    containerId: kek.containerId,
    // A keyring entry is key material plus the epoch id that commits to it —
    // there is no epoch record, so no fingerprint. Selection falls back to the
    // epoch id and AEAD authenticates; the commitment check above is what
    // makes the material itself trustworthy.
    keyEpochHash: null,
    keyMaterial: entry.keyMaterial,
  });
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
  const { kek, successorKeyMaterial } = input;
  if (!successorKeyMaterial) {
    return;
  }

  if (kek.keyring === null) {
    if (kek.containerKeyEpoch !== 1) {
      throw new ContainerKekHistoryUnavailableError(
        projectionKekLabel(input.index),
      );
    }
    return;
  }

  const entries = await openVerifiedKeyringEntries({
    currentManifest: input.currentManifest,
    index: input.index,
    kek,
    successorKeyMaterial,
    verifyKeyringCommitment: input.verifyKeyringCommitment,
  });
  for (const entry of entries) {
    admitKeyringEntry({
      entry,
      index: input.index,
      kek,
      keksByEpochId: input.keksByEpochId,
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
  const projectedEpochIds = new Set<string>();
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
