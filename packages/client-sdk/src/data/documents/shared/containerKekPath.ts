import { type ContainerKeyWrap, decryptWithDek } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../principalPolicyCrypto";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  assertUnwrappedContainerKekMatchesMaterialId,
  projectedUnreachablePredecessorEpochIds,
  projectionKekLabel,
  unwrapKeyringContainerKeksAtIndex,
} from "./containerKekPathHistory";
import {
  type UnwrapContainerKekPathInput,
  verifyContainerKekPathProjection,
} from "./containerKekPathVerification";
import {
  normalizeContainerKeyWrap,
  readManifestContainerId,
  readRecordNullableString,
  readRecordNumber,
  readRecordString,
} from "./readers";
import type { UnwrappedContainerKek } from "./types";

function assertProjectionKekMatchesPath(
  projection: ContainerWriterProjectionResponse,
  index: number,
): void {
  const manifest = projection.path[index];
  const kek = projection.containerKeks[index];
  if (!manifest || !kek) {
    throw new Error("Container writer projection path and KEKs are incomplete");
  }
  if (readManifestContainerId(manifest) !== kek.containerId) {
    throw new Error(`${projectionKekLabel(index)} container is inconsistent`);
  }
  if (kek.accessManifestHash !== manifest.manifestHash) {
    throw new Error(`${projectionKekLabel(index)} manifest is stale`);
  }
  if (!isPlainRecord(kek.keyEpoch)) {
    throw new Error(`${projectionKekLabel(index)} key epoch is invalid`);
  }
  if (
    readRecordString(kek.keyEpoch, "id", projectionKekLabel(index)) !==
      kek.containerKeyEpochId ||
    readRecordString(kek.keyEpoch, "containerId", projectionKekLabel(index)) !==
      kek.containerId ||
    readRecordNumber(kek.keyEpoch, "keyEpoch", projectionKekLabel(index)) !==
      kek.containerKeyEpoch ||
    readRecordNullableString(
      kek.keyEpoch,
      "parentContainerKeyEpochId",
      projectionKekLabel(index),
    ) !== kek.parentContainerKeyEpochId
  ) {
    throw new Error(`${projectionKekLabel(index)} key epoch is inconsistent`);
  }
}

async function unwrapContainerKekFromPrincipalWraps(input: {
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
  wraps: readonly ContainerKeyWrap[];
}): Promise<Uint8Array | null> {
  const envelopes = input.wraps
    .filter((wrap) => wrap.recipientKind !== "container")
    .map((wrap) => ({
      keyFingerprint: wrap.recipientKeyFingerprint,
      kemCipherText: wrap.kemCipherText,
      wrappedKey: wrap.wrappedKey,
    }));
  if (envelopes.length === 0) {
    return null;
  }

  try {
    return await unwrapKeyEnvelopesWithPrincipalPolicies({
      envelopes,
      execSql: input.execSql,
      secretKey: input.secretKey,
    });
  } catch {
    return null;
  }
}

async function unwrapContainerKekFromParentWrap(input: {
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
    return await decryptWithDek(
      {
        iv: base64ToBytes(parentWrap.kemCipherText),
        ciphertext: base64ToBytes(parentWrap.wrappedKey),
      },
      parentKek.keyMaterial,
    );
  } catch (error) {
    throw new Error(`${input.label} parent wrap could not be unwrapped`, {
      cause: error,
    });
  }
}

/**
 * Admits caller-supplied keys that the projection also names.
 *
 * The projection match is deliberate: a seeded key is trusted only once its
 * epoch is one this projection actually carries, which is what makes the
 * material-id check below meaningful. Production seeds this with the epoch it
 * just minted (see `registerIdentity`), never with recovered history — history
 * arrives through the sealed keyring on each path instead, and is shared across
 * authorizing paths through the common `keksByEpochId` map.
 */
async function seedKnownContainerKeks(input: {
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  projection: ContainerWriterProjectionResponse;
}): Promise<Map<string, UnwrappedContainerKek>> {
  const keksByEpochId = new Map<string, UnwrappedContainerKek>();

  for (const [containerKeyEpochId, keyMaterial] of input.knownContainerKeks ??
    new Map<string, Uint8Array>()) {
    const projected = findProjectedContainerKek(
      input.projection,
      containerKeyEpochId,
    );
    if (!projected) {
      continue;
    }
    await assertUnwrappedContainerKekMatchesMaterialId({
      label: projected.label,
      kek: projected.kek,
      keyMaterial,
    });
    keksByEpochId.set(containerKeyEpochId, {
      containerId: projected.kek.containerId,
      keyEpochHash: projected.kek.keyEpochHash,
      keyMaterial,
    });
  }

  return keksByEpochId;
}

function findProjectedContainerKek(
  projection: ContainerWriterProjectionResponse,
  containerKeyEpochId: string,
) {
  for (const [index, current] of projection.containerKeks.entries()) {
    if (current.containerKeyEpochId === containerKeyEpochId) {
      return { kek: current, label: projectionKekLabel(index) };
    }
  }
  return null;
}

function successorKeyMaterial(
  keksByEpochId: ReadonlyMap<string, UnwrappedContainerKek>,
  kek: Pick<
    ContainerWriterProjectionResponse["containerKeks"][number],
    "containerKeyEpochId"
  >,
  unwrapped: Uint8Array | null,
): Uint8Array | null {
  return keksByEpochId.get(kek.containerKeyEpochId)?.keyMaterial ?? unwrapped;
}

async function unwrapContainerKekAtIndex(input: {
  readonly execSql?: ExecSql | undefined;
  readonly index: number;
  readonly keksByEpochId: Map<string, UnwrappedContainerKek>;
  readonly projection: ContainerWriterProjectionResponse;
  readonly secretKey: Uint8Array;
  readonly verifyBridgeCommitment: boolean;
}): Promise<{
  readonly containerId: string;
  readonly error: Error;
  readonly unreachableEpochIds: readonly string[];
} | null> {
  assertProjectionKekMatchesPath(input.projection, input.index);
  const kek = input.projection.containerKeks[input.index];
  const currentManifest = input.projection.path[input.index];
  if (!kek || !currentManifest) {
    throw new Error(`${projectionKekLabel(input.index)} is missing`);
  }

  const wraps: ContainerKeyWrap[] = [];
  for (const rawWrap of kek.wraps) {
    const wrap = normalizeContainerKeyWrap(rawWrap);
    if (wrap.containerKeyEpochId === kek.containerKeyEpochId) {
      wraps.push(wrap);
    }
  }
  if (wraps.length !== kek.wraps.length) {
    throw new Error(`${projectionKekLabel(input.index)} contains a stale wrap`);
  }

  const unwrapped =
    (await unwrapContainerKekFromPrincipalWraps({
      execSql: input.execSql,
      secretKey: input.secretKey,
      wraps,
    })) ??
    (await unwrapContainerKekFromParentWrap({
      label: projectionKekLabel(input.index),
      parentContainerKeyEpochId: kek.parentContainerKeyEpochId,
      parentKeksByEpochId: input.keksByEpochId,
      wraps,
    }));

  if (unwrapped) {
    await assertUnwrappedContainerKekMatchesMaterialId({
      label: projectionKekLabel(input.index),
      kek,
      keyMaterial: unwrapped,
    });
    input.keksByEpochId.set(kek.containerKeyEpochId, {
      containerId: kek.containerId,
      keyEpochHash: kek.keyEpochHash,
      keyMaterial: unwrapped,
    });
  }

  try {
    // Open the keyring immediately so descendants pinned to an older parent
    // epoch can still unwrap during the same path walk.
    await unwrapKeyringContainerKeksAtIndex({
      currentManifest,
      index: input.index,
      kek,
      keksByEpochId: input.keksByEpochId,
      successorKeyMaterial: successorKeyMaterial(
        input.keksByEpochId,
        kek,
        unwrapped,
      ),
      verifyKeyringCommitment: input.verifyBridgeCommitment,
    });
    return null;
  } catch (error) {
    // Historical keyring damage must not discard an independently verified
    // current KEK. If the target still cannot be reached, the caller
    // surfaces this integrity error; the bridge log remains the recovery
    // path for the orphaned epochs.
    return {
      containerId: kek.containerId,
      error:
        error instanceof Error
          ? error
          : new Error("Container predecessor KEK recovery failed", {
              cause: error,
            }),
      unreachableEpochIds: projectedUnreachablePredecessorEpochIds({
        kek,
        keksByEpochId: input.keksByEpochId,
      }),
    };
  }
}

interface UnwrappedContainerKekPathResult {
  readonly keksByEpochId: ReadonlyMap<string, Uint8Array>;
  readonly predecessorFailuresByEpochId: ReadonlyMap<string, Error>;
  readonly unattributedPredecessorFailuresByContainerId: ReadonlyMap<
    string,
    Error
  >;
}

function recordPredecessorFailure(
  failuresByEpochId: Map<string, Error>,
  unattributedFailuresByContainerId: Map<string, Error>,
  failure: NonNullable<Awaited<ReturnType<typeof unwrapContainerKekAtIndex>>>,
): void {
  if (failure.unreachableEpochIds.length === 0) {
    if (!unattributedFailuresByContainerId.has(failure.containerId)) {
      unattributedFailuresByContainerId.set(failure.containerId, failure.error);
    }
    return;
  }
  for (const containerKeyEpochId of failure.unreachableEpochIds) {
    if (!failuresByEpochId.has(containerKeyEpochId)) {
      failuresByEpochId.set(containerKeyEpochId, failure.error);
    }
  }
}

function assertTargetKekUnwrapped(input: {
  readonly keyMaterialByEpochId: ReadonlyMap<string, Uint8Array>;
  readonly predecessorFailuresByEpochId: ReadonlyMap<string, Error>;
  readonly projection: ContainerWriterProjectionResponse;
  readonly unattributedPredecessorFailuresByContainerId: ReadonlyMap<
    string,
    Error
  >;
}): void {
  const targetKek = input.projection.containerKeks.at(-1);
  if (
    !targetKek ||
    input.keyMaterialByEpochId.has(targetKek.containerKeyEpochId)
  ) {
    return;
  }
  for (
    let index = input.projection.containerKeks.length - 1;
    index >= 0;
    index -= 1
  ) {
    const pathKek = input.projection.containerKeks[index];
    if (!pathKek) {
      continue;
    }
    const predecessorFailure =
      input.predecessorFailuresByEpochId.get(pathKek.containerKeyEpochId) ??
      (pathKek.parentContainerKeyEpochId
        ? input.predecessorFailuresByEpochId.get(
            pathKek.parentContainerKeyEpochId,
          )
        : undefined) ??
      input.unattributedPredecessorFailuresByContainerId.get(
        pathKek.containerId,
      );
    if (predecessorFailure) {
      throw predecessorFailure;
    }
  }
  throw new Error(
    `${projectionKekLabel(input.projection.containerKeks.length - 1)} could not be unwrapped`,
  );
}

export async function unwrapContainerKekPathWithHistoryFailures(
  input: UnwrapContainerKekPathInput,
): Promise<UnwrappedContainerKekPathResult> {
  await verifyContainerKekPathProjection(input);

  const keksByEpochId = await seedKnownContainerKeks({
    knownContainerKeks: input.knownContainerKeks,
    projection: input.projection,
  });
  const predecessorFailuresByEpochId = new Map<string, Error>();
  const unattributedPredecessorFailuresByContainerId = new Map<string, Error>();

  for (
    let index = 0;
    index < input.projection.containerKeks.length;
    index += 1
  ) {
    const currentFailure = await unwrapContainerKekAtIndex({
      execSql: input.execSql,
      index,
      keksByEpochId,
      projection: input.projection,
      secretKey: input.secretKey,
      verifyBridgeCommitment: input.trustedLocalProjection !== true,
    });
    if (currentFailure) {
      recordPredecessorFailure(
        predecessorFailuresByEpochId,
        unattributedPredecessorFailuresByContainerId,
        currentFailure,
      );
    }
  }

  const keyMaterialByEpochId = new Map<string, Uint8Array>();
  for (const [containerKeyEpochId, kek] of keksByEpochId) {
    keyMaterialByEpochId.set(containerKeyEpochId, kek.keyMaterial);
  }
  assertTargetKekUnwrapped({
    keyMaterialByEpochId,
    predecessorFailuresByEpochId,
    projection: input.projection,
    unattributedPredecessorFailuresByContainerId,
  });
  return {
    keksByEpochId: keyMaterialByEpochId,
    predecessorFailuresByEpochId,
    unattributedPredecessorFailuresByContainerId,
  };
}

export async function unwrapContainerKekPath(
  input: UnwrapContainerKekPathInput,
): Promise<ReadonlyMap<string, Uint8Array>> {
  return (await unwrapContainerKekPathWithHistoryFailures(input)).keksByEpochId;
}
