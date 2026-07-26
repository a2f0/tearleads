import {
  type ContainerKeyWrap,
  computeContainerKekMaterialId,
  decryptWithDek,
  isContainerKekMaterialId,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  ContainerWriterProjectionResponse,
  HistoricalContainerKekResponse,
} from "@tearleads/validators/response";
import {
  type PrincipalPolicyCache,
  verifyContainerWriterProjection,
} from "../../keyingProjectionVerification";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../principalPolicyCrypto";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  normalizeContainerKeyWrap,
  readManifestContainerId,
  readRecordNullableString,
  readRecordNumber,
  readRecordString,
} from "./readers";
import type {
  ProjectionVerificationOptions,
  UnwrappedContainerKek,
} from "./types";
import { resolveProjectionVerifier } from "./types";

function projectionKekLabel(index: number): string {
  return `Container writer projection KEK[${index}]`;
}

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

  return decryptWithDek(
    {
      iv: base64ToBytes(parentWrap.kemCipherText),
      ciphertext: base64ToBytes(parentWrap.wrappedKey),
    },
    parentKek.keyMaterial,
  );
}

async function assertUnwrappedContainerKekMatchesMaterialId(input: {
  index: number;
  keyMaterial: Uint8Array;
  kek: Pick<
    ContainerWriterProjectionResponse["containerKeks"][number],
    "containerId" | "containerKeyEpoch" | "containerKeyEpochId"
  >;
}): Promise<void> {
  if (!isContainerKekMaterialId(input.kek.containerKeyEpochId)) {
    throw new Error(
      `${projectionKekLabel(input.index)} KEK epoch id does not commit to key material`,
    );
  }

  const expectedId = await computeContainerKekMaterialId({
    containerId: input.kek.containerId,
    keyEpoch: input.kek.containerKeyEpoch,
    keyMaterial: input.keyMaterial,
  });
  if (expectedId !== input.kek.containerKeyEpochId) {
    throw new Error(
      `${projectionKekLabel(input.index)} KEK material does not match committed epoch id`,
    );
  }
}

async function seedKnownContainerKeks(input: {
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  projection: ContainerWriterProjectionResponse;
}): Promise<Map<string, UnwrappedContainerKek>> {
  const keksByEpochId = new Map<string, UnwrappedContainerKek>();

  for (const [containerKeyEpochId, keyMaterial] of input.knownContainerKeks ??
    new Map<string, Uint8Array>()) {
    const index = input.projection.containerKeks.findIndex(
      (candidate) => candidate.containerKeyEpochId === containerKeyEpochId,
    );
    const kek = input.projection.containerKeks[index];
    if (!kek) {
      continue;
    }
    await assertUnwrappedContainerKekMatchesMaterialId({
      index,
      kek,
      keyMaterial,
    });
    keksByEpochId.set(containerKeyEpochId, {
      containerId: kek.containerId,
      keyEpochHash: kek.keyEpochHash,
      keyMaterial,
    });
  }

  return keksByEpochId;
}

export async function unwrapContainerKekPath(
  input: {
    execSql?: ExecSql | undefined;
    knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
    principalPolicyCache?: PrincipalPolicyCache | undefined;
    projection: ContainerWriterProjectionResponse;
    secretKey: Uint8Array;
    verifiedByHash?: Map<string, VerifiedContainerAccessManifest> | undefined;
  } & ProjectionVerificationOptions,
): Promise<ReadonlyMap<string, Uint8Array>> {
  if (input.projection.path.length !== input.projection.containerKeks.length) {
    throw new Error(
      "Container writer projection path and KEKs are inconsistent",
    );
  }
  const resolveProjectionUserKey = resolveProjectionVerifier(
    input,
    "Container KEK unwrap",
  );
  if (
    input.trustedLocalProjection !== true &&
    resolveProjectionUserKey !== null
  ) {
    // Reuse the caller's verification caches so manifests/policies already
    // verified by the projection-consistency pass are not re-verified here.
    await verifyContainerWriterProjection({
      execSql: input.execSql,
      principalPolicyCache: input.principalPolicyCache,
      projection: input.projection,
      resolveUserKey: resolveProjectionUserKey,
      verifiedByHash: input.verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  }

  const keksByEpochId = await seedKnownContainerKeks({
    knownContainerKeks: input.knownContainerKeks,
    projection: input.projection,
  });

  for (
    let index = 0;
    index < input.projection.containerKeks.length;
    index += 1
  ) {
    assertProjectionKekMatchesPath(input.projection, index);
    const kek = input.projection.containerKeks[index];
    if (!kek) {
      throw new Error(`${projectionKekLabel(index)} is missing`);
    }

    const wraps: ContainerKeyWrap[] = [];
    for (const rawWrap of kek.wraps) {
      const wrap = normalizeContainerKeyWrap(rawWrap);
      if (wrap.containerKeyEpochId === kek.containerKeyEpochId) {
        wraps.push(wrap);
      }
    }
    if (wraps.length !== kek.wraps.length) {
      throw new Error(`${projectionKekLabel(index)} contains a stale wrap`);
    }

    const unwrapped =
      (await unwrapContainerKekFromPrincipalWraps({
        execSql: input.execSql,
        secretKey: input.secretKey,
        wraps,
      })) ??
      (await unwrapContainerKekFromParentWrap({
        parentContainerKeyEpochId: kek.parentContainerKeyEpochId,
        parentKeksByEpochId: keksByEpochId,
        wraps,
      }));

    if (unwrapped) {
      await assertUnwrappedContainerKekMatchesMaterialId({
        index,
        kek,
        keyMaterial: unwrapped,
      });
      keksByEpochId.set(kek.containerKeyEpochId, {
        containerId: kek.containerId,
        keyEpochHash: kek.keyEpochHash,
        keyMaterial: unwrapped,
      });
    }

    // Unwrap this container's superseded epochs BEFORE moving to its
    // descendants: after an ancestor rotation, a descendant not yet rekeyed
    // still wraps its CURRENT epoch to the ancestor's superseded epoch, so
    // that material must already be in the map when the descendant is
    // attempted. Runs even when the current epoch could not be unwrapped —
    // the superseded epochs carry their own audience wraps.
    await unwrapHistoricalContainerKeksAtIndex({
      execSql: input.execSql,
      index,
      kek,
      keksByEpochId,
      secretKey: input.secretKey,
    });
  }

  const keyMaterialByEpochId = new Map<string, Uint8Array>();
  for (const [containerKeyEpochId, kek] of keksByEpochId) {
    keyMaterialByEpochId.set(containerKeyEpochId, kek.keyMaterial);
  }
  const targetKek = input.projection.containerKeks.at(-1);
  if (targetKek && !keyMaterialByEpochId.has(targetKek.containerKeyEpochId)) {
    throw new Error(
      `${projectionKekLabel(input.projection.containerKeks.length - 1)} could not be unwrapped`,
    );
  }
  return keyMaterialByEpochId;
}

/**
 * Unwraps the superseded key epochs the projection serves alongside each path
 * container, so a member who spans a KEK rotation can still decrypt
 * pre-rotation content (stale content-key bundles, old-epoch updates).
 *
 * Fail-soft per epoch: a member who was not in an epoch's audience simply
 * cannot unwrap it and the epoch is skipped. Integrity does not rest on the
 * wraps themselves — every successful unwrap is re-verified against the
 * epoch id's key-material commitment, so a server cannot substitute key
 * material for an epoch that verified artifacts reference. Each container's
 * superseded epochs are unwrapped inside the path walk, right after its
 * current epoch, because a descendant not yet rekeyed after an ancestor
 * rotation wraps its CURRENT epoch to the ancestor's superseded epoch — the
 * material must be in the map before the descendant is attempted.
 *
 * WHO may receive a historical wrap is deliberately not re-verified here:
 * the server never holds KEK material, so any wrap passing the commitment
 * check was created by a legitimate epoch-key holder and decrypts only with
 * a recipient key this client already possesses — a client-side audience
 * check could refuse to use a capability the client holds, but cannot
 * create a cryptographic boundary. Audience enforcement therefore lives in
 * the server's era-pinned filter (see the API's loadHistoricalContainerKeks),
 * and these keys are only ever used to DECRYPT pre-rotation artifacts whose
 * authenticity rests on signed write headers; heals always wrap fresh keys
 * to the verified current targets.
 */
function historicalContainerKekWraps(
  historical: HistoricalContainerKekResponse,
  index: number,
): ContainerKeyWrap[] {
  const wraps: ContainerKeyWrap[] = [];
  for (const rawWrap of historical.wraps) {
    const wrap = normalizeContainerKeyWrap(rawWrap);
    if (wrap.containerKeyEpochId === historical.containerKeyEpochId) {
      wraps.push(wrap);
    }
  }
  if (wraps.length !== historical.wraps.length) {
    throw new Error(
      `${projectionKekLabel(index)} historical epoch contains a stale wrap`,
    );
  }
  return wraps;
}

async function unwrapOneHistoricalContainerKek(input: {
  execSql?: ExecSql | undefined;
  historical: HistoricalContainerKekResponse;
  index: number;
  keksByEpochId: Map<string, UnwrappedContainerKek>;
  secretKey: Uint8Array;
}): Promise<void> {
  const wraps = historicalContainerKekWraps(input.historical, input.index);

  let unwrapped: Uint8Array | null = null;
  try {
    unwrapped =
      (await unwrapContainerKekFromPrincipalWraps({
        execSql: input.execSql,
        secretKey: input.secretKey,
        wraps,
      })) ??
      (await unwrapContainerKekFromParentWrap({
        parentContainerKeyEpochId: input.historical.parentContainerKeyEpochId,
        parentKeksByEpochId: input.keksByEpochId,
        wraps,
      }));
  } catch {
    unwrapped = null;
  }
  if (!unwrapped) {
    return;
  }
  await assertUnwrappedContainerKekMatchesMaterialId({
    index: input.index,
    kek: input.historical,
    keyMaterial: unwrapped,
  });
  input.keksByEpochId.set(input.historical.containerKeyEpochId, {
    containerId: input.historical.containerId,
    keyEpochHash: input.historical.keyEpochHash,
    keyMaterial: unwrapped,
  });
}

async function unwrapHistoricalContainerKeksAtIndex(input: {
  execSql?: ExecSql | undefined;
  index: number;
  kek: ContainerWriterProjectionResponse["containerKeks"][number];
  keksByEpochId: Map<string, UnwrappedContainerKek>;
  secretKey: Uint8Array;
}): Promise<void> {
  for (const historical of input.kek.historicalKeks ?? []) {
    if (input.keksByEpochId.has(historical.containerKeyEpochId)) {
      continue;
    }
    if (historical.containerId !== input.kek.containerId) {
      throw new Error(
        `${projectionKekLabel(input.index)} historical epoch container is inconsistent`,
      );
    }
    await unwrapOneHistoricalContainerKek({
      execSql: input.execSql,
      historical,
      index: input.index,
      keksByEpochId: input.keksByEpochId,
      secretKey: input.secretKey,
    });
  }
}
