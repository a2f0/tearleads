import { type ContainerKeyWrap, decryptWithDek } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../principalPolicyCrypto";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  assertUnwrappedContainerKekMatchesMaterialId,
  projectionKekLabel,
  unwrapPredecessorContainerKeksAtIndex,
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

  const parentWrap = input.wraps.find(
    (wrap) =>
      wrap.recipientKind === "container" &&
      wrap.recipientId === parentKek.containerId &&
      wrap.recipientKeyEpochId === input.parentContainerKeyEpochId &&
      wrap.recipientKeyFingerprint === parentKek.keyEpochHash,
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
    const predecessor = current.predecessorKeks.find(
      (candidate) => candidate.containerKeyEpochId === containerKeyEpochId,
    );
    if (predecessor) {
      return {
        kek: predecessor,
        label: `${projectionKekLabel(index)} predecessor ${containerKeyEpochId}`,
      };
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
}): Promise<{ readonly containerId: string; readonly error: unknown } | null> {
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
    // Derive predecessors immediately so descendants pinned to an older parent
    // epoch can still unwrap during the same path walk.
    await unwrapPredecessorContainerKeksAtIndex({
      currentManifest,
      index: input.index,
      kek,
      keksByEpochId: input.keksByEpochId,
      successorKeyMaterial: successorKeyMaterial(
        input.keksByEpochId,
        kek,
        unwrapped,
      ),
      verifyBridgeCommitment: input.verifyBridgeCommitment,
    });
    return null;
  } catch (error) {
    // Historical bridge damage must not discard an independently verified
    // current KEK. Keep any predecessors derived before the failure; if the
    // target still cannot be reached, the caller surfaces this integrity error.
    return { containerId: kek.containerId, error };
  }
}

interface UnwrappedContainerKekPathResult {
  readonly keksByEpochId: ReadonlyMap<string, Uint8Array>;
  readonly predecessorFailuresByContainerId: ReadonlyMap<string, unknown>;
}

export async function unwrapContainerKekPathWithHistoryFailures(
  input: UnwrapContainerKekPathInput,
): Promise<UnwrappedContainerKekPathResult> {
  await verifyContainerKekPathProjection(input);

  const keksByEpochId = await seedKnownContainerKeks({
    knownContainerKeks: input.knownContainerKeks,
    projection: input.projection,
  });
  const predecessorFailuresByContainerId = new Map<string, unknown>();

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
      predecessorFailuresByContainerId.set(
        currentFailure.containerId,
        currentFailure.error,
      );
    }
  }

  const keyMaterialByEpochId = new Map<string, Uint8Array>();
  for (const [containerKeyEpochId, kek] of keksByEpochId) {
    keyMaterialByEpochId.set(containerKeyEpochId, kek.keyMaterial);
  }
  const targetKek = input.projection.containerKeks.at(-1);
  if (targetKek && !keyMaterialByEpochId.has(targetKek.containerKeyEpochId)) {
    for (
      let index = input.projection.containerKeks.length - 1;
      index >= 0;
      index -= 1
    ) {
      const pathKek = input.projection.containerKeks[index];
      const predecessorFailure = pathKek
        ? predecessorFailuresByContainerId.get(pathKek.containerId)
        : undefined;
      if (predecessorFailure !== undefined) {
        throw predecessorFailure;
      }
    }
    throw new Error(
      `${projectionKekLabel(input.projection.containerKeks.length - 1)} could not be unwrapped`,
    );
  }
  return {
    keksByEpochId: keyMaterialByEpochId,
    predecessorFailuresByContainerId,
  };
}

export async function unwrapContainerKekPath(
  input: UnwrapContainerKekPathInput,
): Promise<ReadonlyMap<string, Uint8Array>> {
  return (await unwrapContainerKekPathWithHistoryFailures(input)).keksByEpochId;
}
