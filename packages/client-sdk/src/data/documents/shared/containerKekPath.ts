import {
  type ContainerKeyWrap,
  computeContainerKekMaterialId,
  computeContainerKekPredecessorBridgeHash,
  computeContainerKeyEpochHash,
  decryptWithDek,
  isContainerKekMaterialId,
  normalizeContainerAccessEventBody,
  normalizeContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../keyingCanonicalJson";
import {
  type PrincipalPolicyCache,
  verifyContainerWriterProjection,
} from "../../keyingProjectionVerification";
import { readContainerKeyEpoch } from "../../keyingProjectionVerification/readers";
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
      label: projectionKekLabel(index),
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
    const currentManifest = input.projection.path[index];
    if (!kek || !currentManifest) {
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
        label: projectionKekLabel(index),
        kek,
        keyMaterial: unwrapped,
      });
      keksByEpochId.set(kek.containerKeyEpochId, {
        containerId: kek.containerId,
        keyEpochHash: kek.keyEpochHash,
        keyMaterial: unwrapped,
      });
    }

    // Predecessors are derived immediately after their current path KEK so a
    // descendant still wrapped to an older parent epoch can be unwrapped.
    await unwrapPredecessorContainerKeksAtIndex({
      currentManifest,
      index,
      kek,
      keksByEpochId,
      successorKeyMaterial: successorKeyMaterial(keksByEpochId, kek, unwrapped),
      verifyBridgeCommitment: input.trustedLocalProjection !== true,
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

async function unwrapPredecessorContainerKeksAtIndex(input: {
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
  // The projection may include updates encrypted under any epoch in document
  // history. Returning only the current key would make those updates silently
  // unreadable, so an authenticated-but-incomplete history is a hard failure.
  if (input.kek.predecessorKeks.length !== input.kek.containerKeyEpoch - 1) {
    throw new Error(
      `${projectionKekLabel(input.index)} predecessor chain is incomplete`,
    );
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
    ...input.kek.containerManifestHistory.map((bundle) => bundle.manifestHash),
  ]);
  for (const predecessor of input.kek.predecessorKeks) {
    if (
      predecessor.containerId !== input.kek.containerId ||
      predecessor.containerKeyEpoch !== successorEpoch - 1 ||
      !verifiedManifestHashes.has(predecessor.accessManifestHash)
    ) {
      throw new Error(
        `${projectionKekLabel(input.index)} predecessor epoch is inconsistent`,
      );
    }

    const keyEpoch = readContainerKeyEpoch(
      predecessor.keyEpoch,
      `${projectionKekLabel(input.index)} predecessor key epoch`,
    );
    if (
      keyEpoch.id !== predecessor.containerKeyEpochId ||
      keyEpoch.containerId !== predecessor.containerId ||
      keyEpoch.keyEpoch !== predecessor.containerKeyEpoch ||
      keyEpoch.accessManifestHash !== predecessor.accessManifestHash ||
      keyEpoch.parentContainerKeyEpochId !==
        predecessor.parentContainerKeyEpochId ||
      (await computeContainerKeyEpochHash(keyEpoch)) !==
        predecessor.keyEpochHash
    ) {
      throw new Error(
        `${projectionKekLabel(input.index)} predecessor key epoch is invalid`,
      );
    }

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

    const predecessorKeyMaterial = await unwrapContainerKekPredecessorBridge({
      bridge,
      successorContainerKey: successorKeyMaterial,
    });
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
    successorEpochId = predecessor.containerKeyEpochId;
    successorEpoch = predecessor.containerKeyEpoch;
    successorManifestHash = predecessor.accessManifestHash;
    successorKeyMaterial = predecessorKeyMaterial;
  }
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
      : input.kek.containerManifestHistory.find(
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
