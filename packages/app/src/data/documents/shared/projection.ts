import type {
  ContainerKeyWrap,
  DocumentContentKeyTarget,
} from "@tearleads/crypto";
import {
  computeContainerKekMaterialId,
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  decryptWithDek,
  encryptWithDek,
  isContainerKekMaterialId,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentContentKeyTargetEnvelope } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  readCanonicalRecordPaths,
  readCanonicalRecords,
} from "../../keyingCanonicalJson";
import {
  verifyContainerWriterProjection,
  verifyDocumentWriterProjection,
} from "../../keyingProjectionVerification";
import type { ExecSql } from "../../persistence/sqlSchema";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../principalPolicyCrypto";
import {
  assertDocumentManifestBundleConsistent,
  assertEqualBytes,
  errorMessage,
  normalizeContainerKeyWrap,
  normalizeDocumentKekTargetResponse,
  readManifestContainerId,
  readRecordNullableString,
  readRecordNumber,
  readRecordString,
  serializeCanonical,
  sortDocumentTargets,
  targetEnvelopeReference,
  targetKey,
  uniqueSortedStrings,
} from "./readers";
import type {
  DocumentLinkSetMutationOperation,
  ProjectionVerificationOptions,
  UnwrappedContainerKek,
} from "./types";
import {
  projectionVerificationOptions,
  resolveProjectionVerifier,
} from "./types";

function projectionKekLabel(index: number): string {
  return `Container writer projection KEK[${index}]`;
}

function assertSortedStringsEqual(
  left: readonly string[],
  right: readonly string[],
  message: string,
): void {
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    throw new Error(message);
  }
}

function assertAuthorizingContainerPathsMatchDocumentTargets(input: {
  targets: readonly DocumentContentKeyTarget[];
  writerProjection: DocumentWriterProjectionResponse;
}): void {
  if (input.writerProjection.authorizingContainerPaths.length === 0) {
    throw new Error("Document writer projection authorization paths missing");
  }

  const targetKeys = new Set(input.targets.map(targetKey));
  for (const [
    index,
    projection,
  ] of input.writerProjection.authorizingContainerPaths.entries()) {
    let projectionTarget: DocumentContentKeyTarget;
    try {
      projectionTarget = deriveDocumentTargetFromProjection(projection);
    } catch (error) {
      throw new Error(
        `Document writer projection authorization path[${index}] is invalid: ${errorMessage(error)}`,
      );
    }

    if (targetKeys.has(targetKey(projectionTarget))) {
      continue;
    }

    // Bind server-supplied KEK paths to committed document targets before
    // using any unwrapped path KEK for document content-key material.
    throw new Error(
      `Document writer projection authorization path[${index}] is not a document target`,
    );
  }
}

export async function assertDocumentWriterProjectionConsistent(
  writerProjection: DocumentWriterProjectionResponse,
  input: ProjectionVerificationOptions,
): Promise<DocumentContentKeyTarget[]> {
  const resolveProjectionUserKey = resolveProjectionVerifier(
    input,
    "Document writer projection",
  );
  if (resolveProjectionUserKey) {
    await verifyDocumentWriterProjection({
      projection: writerProjection,
      resolveUserKey: resolveProjectionUserKey,
    });
  }

  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: writerProjection.documentManifest,
    label: "Document writer projection manifest",
  });
  const { documentId } = manifestIdentity;
  if (
    writerProjection.documentId !== documentId ||
    writerProjection.documentKekTargets.documentId !== documentId ||
    writerProjection.contentKeyBundle.documentId !== documentId
  ) {
    throw new Error("Document writer projection document id mismatch");
  }
  const { manifestHash } = writerProjection.documentManifest;
  if (
    writerProjection.documentKekTargets.linkSetManifestHash !== manifestHash ||
    writerProjection.contentKeyBundle.linkSetManifestHash !== manifestHash
  ) {
    throw new Error("Document writer projection link manifest mismatch");
  }
  if (
    writerProjection.documentKekTargets.documentKeyTargetHash !==
    writerProjection.contentKeyBundle.targetHash
  ) {
    throw new Error("Document writer projection target hash mismatch");
  }

  const targets = currentDocumentTargets(writerProjection);
  const canonicalTargetHash =
    await computeDocumentContentKeyTargetHash(targets);
  if (
    canonicalTargetHash !==
    writerProjection.documentKekTargets.documentKeyTargetHash
  ) {
    throw new Error("Document writer projection target hash is not canonical");
  }

  assertSortedStringsEqual(
    uniqueSortedStrings(targets.map((target) => target.containerId)),
    readLinkedContainerIdsFromDocumentManifest(writerProjection),
    "Document writer projection targets do not match linked containers",
  );
  assertSortedStringsEqual(
    uniqueSortedStrings(
      writerProjection.documentKekTargets.linkedContainerManifestHashes,
    ),
    uniqueSortedStrings(targets.map((target) => target.containerManifestHash)),
    "Document writer projection target manifest summary mismatch",
  );
  assertSortedStringsEqual(
    uniqueSortedStrings(
      writerProjection.documentKekTargets.linkedContainerKeyEpochIds,
    ),
    uniqueSortedStrings(targets.map((target) => target.containerKeyEpochId)),
    "Document writer projection target KEK summary mismatch",
  );
  assertAuthorizingContainerPathsMatchDocumentTargets({
    targets,
    writerProjection,
  });

  return targets;
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
  kek: ContainerWriterProjectionResponse["containerKeks"][number];
}): Promise<void> {
  if (!isContainerKekMaterialId(input.kek.containerKeyEpochId)) {
    return;
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

export async function unwrapContainerKekPath(
  input: {
    execSql?: ExecSql | undefined;
    projection: ContainerWriterProjectionResponse;
    secretKey: Uint8Array;
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
  if (resolveProjectionUserKey) {
    await verifyContainerWriterProjection({
      projection: input.projection,
      resolveUserKey: resolveProjectionUserKey,
    });
  }

  const keksByEpochId = new Map<string, UnwrappedContainerKek>();

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

    if (!unwrapped) {
      continue;
    }
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

function getOnlyDocumentCreateTarget(
  projection: ContainerWriterProjectionResponse,
): DocumentContentKeyTarget {
  const target = deriveDocumentCreateTargets(projection)[0];
  if (!target) {
    throw new Error("Document create target is unavailable");
  }
  return target;
}

export async function wrapDocumentContentKeyForCreate(
  input: {
    contentKey: Uint8Array;
    execSql?: ExecSql | undefined;
    projection: ContainerWriterProjectionResponse;
    secretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<DocumentContentKeyTargetEnvelope[]> {
  const target = getOnlyDocumentCreateTarget(input.projection);
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.projection,
    secretKey: input.secretKey,
    ...projectionVerificationOptions(input),
  });
  const targetKek = keksByEpochId.get(target.containerKeyEpochId);
  if (!targetKek) {
    throw new Error("Document create target KEK could not be unwrapped");
  }

  const wrapped = await encryptWithDek(input.contentKey, targetKek);

  return [
    {
      ...target,
      wrappedKey: bytesToBase64(wrapped.ciphertext),
      wrappingMetadata: {
        suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
        iv: bytesToBase64(wrapped.iv),
      },
    },
  ];
}

export async function unwrapDocumentContentKeyTarget(input: {
  containerKek: Uint8Array;
  envelope: DocumentContentKeyTargetEnvelope;
}): Promise<Uint8Array> {
  const metadata = input.envelope.wrappingMetadata;
  const suite = isPlainRecord(metadata)
    ? Reflect.get(metadata, "suite")
    : undefined;
  const iv = isPlainRecord(metadata) ? Reflect.get(metadata, "iv") : undefined;
  if (suite !== DOCUMENT_CONTENT_KEY_WRAP_SUITE) {
    throw new Error("Document content-key target uses an unknown suite");
  }
  if (typeof iv !== "string" || iv.length === 0) {
    throw new Error("Document content-key target is missing an IV");
  }

  return decryptWithDek(
    {
      iv: base64ToBytes(iv),
      ciphertext: base64ToBytes(input.envelope.wrappedKey),
    },
    input.containerKek,
  );
}

export function deriveDocumentCreateTargets(
  projection: ContainerWriterProjectionResponse,
): DocumentContentKeyTarget[] {
  const targetIndex = projection.path.length - 1;
  const targetManifest = projection.path[targetIndex];
  if (!targetManifest) {
    throw new Error("Container writer projection path is empty");
  }

  if (readManifestContainerId(targetManifest) !== projection.containerId) {
    throw new Error("Container writer projection target path is inconsistent");
  }

  const targetKek = projection.containerKeks[targetIndex];
  if (!targetKek) {
    throw new Error("Container writer projection target KEK is unavailable");
  }
  if (targetKek.containerId !== projection.containerId) {
    throw new Error("Container writer projection target KEK is inconsistent");
  }
  if (targetKek.accessManifestHash !== targetManifest.manifestHash) {
    throw new Error("Container writer projection target KEK is stale");
  }

  return [
    {
      containerId: targetKek.containerId,
      containerManifestHash: targetKek.accessManifestHash,
      containerKeyEpochId: targetKek.containerKeyEpochId,
      containerKeyEpoch: targetKek.containerKeyEpoch,
    },
  ];
}

export function mergeTargetEnvelopes(
  targets: readonly DocumentContentKeyTarget[],
  envelopes: readonly DocumentContentKeyTargetEnvelope[],
): DocumentContentKeyTargetEnvelope[] {
  const expectedByKey = new Map(
    targets.map((target) => [targetKey(target), target]),
  );
  const envelopeByKey = new Map<string, DocumentContentKeyTargetEnvelope>();

  for (const envelope of envelopes) {
    const key = targetKey(envelope);
    if (!expectedByKey.has(key)) {
      throw new Error("Document content-key target envelope is unexpected");
    }
    if (envelopeByKey.has(key)) {
      throw new Error("Document content-key target envelope is duplicated");
    }
    if (envelope.wrappedKey.length === 0) {
      throw new Error("Document content-key target envelope is empty");
    }
    if (!isPlainRecord(envelope.wrappingMetadata)) {
      throw new Error(
        "Document content-key target wrapping metadata must be an object",
      );
    }
    envelopeByKey.set(key, envelope);
  }

  return sortDocumentTargets(targets).map((target) => {
    const envelope = envelopeByKey.get(targetKey(target));
    if (!envelope) {
      throw new Error("Document content-key target envelope is missing");
    }
    return envelope;
  });
}

export function projectionPathRecords(
  projection: ContainerWriterProjectionResponse,
): Record<string, unknown>[] {
  return readCanonicalRecords(projection.path, "Document projection path");
}

function projectionLeafContainerId(
  projection: ContainerWriterProjectionResponse,
): string | null {
  const leafBundle = projection.path.at(-1);
  return leafBundle ? readManifestContainerId(leafBundle) : null;
}

function describeProjectionTargetKek(
  projection: ContainerWriterProjectionResponse,
): string {
  const targetKek = projection.containerKeks.at(-1);
  const containerId =
    projectionLeafContainerId(projection) ??
    targetKek?.containerId ??
    projection.containerId;
  return targetKek
    ? `container ${containerId} epoch ${targetKek.containerKeyEpochId}`
    : `container ${containerId}`;
}

export function deriveDocumentTargetFromProjection(
  projection: ContainerWriterProjectionResponse,
): DocumentContentKeyTarget {
  const target = deriveDocumentCreateTargets(projection)[0];
  if (!target) {
    throw new Error("Document target projection is unavailable");
  }
  return target;
}

export function readLinkedContainerIdsFromDocumentManifest(
  writerProjection: DocumentWriterProjectionResponse,
): string[] {
  const state = writerProjection.documentManifest.state;
  const linkedContainerIds = isPlainRecord(state)
    ? Reflect.get(state, "linkedContainerIds")
    : undefined;
  if (
    !Array.isArray(linkedContainerIds) ||
    linkedContainerIds.some(
      (containerId) =>
        typeof containerId !== "string" || containerId.length === 0,
    )
  ) {
    throw new Error("Document link-set state is invalid");
  }

  return uniqueSortedStrings(linkedContainerIds);
}

export function currentDocumentTargets(
  writerProjection: DocumentWriterProjectionResponse,
): DocumentContentKeyTarget[] {
  const targets = normalizeDocumentKekTargetResponse(
    writerProjection.documentKekTargets,
  );
  const bundleTargets = sortDocumentTargets(
    writerProjection.contentKeyBundle.targets.map(targetEnvelopeReference),
  );

  if (
    serializeCanonical(targets, "KEK targets") !==
    serializeCanonical(bundleTargets, "content-key targets")
  ) {
    throw new Error("Document link-set content-key targets mismatch");
  }

  return targets;
}

export function authorizingContainerPathRecordsForLinkSet(input: {
  operation: DocumentLinkSetMutationOperation;
  targetContainerId: string;
  writerProjection: DocumentWriterProjectionResponse;
}): Record<string, unknown>[][] {
  const paths = input.writerProjection.authorizingContainerPaths.filter(
    (projection) =>
      input.operation === "link" ||
      projectionLeafContainerId(projection) !== input.targetContainerId,
  );
  if (paths.length === 0) {
    throw new Error("Document link-set authorizing paths are missing");
  }

  return paths.map(projectionPathRecords);
}

export function authorizingContainerPathRecords(
  writerProjection: DocumentWriterProjectionResponse,
): Record<string, unknown>[][] {
  return readCanonicalRecordPaths(
    writerProjection.authorizingContainerPaths.map(
      (projection) => projection.path,
    ),
    "Document authorizing container paths",
  );
}

export async function collectContainerKeksForDocumentSync(input: {
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<ReadonlyMap<string, Uint8Array>> {
  const keksByEpochId = new Map<string, Uint8Array>();

  for (const projection of input.writerProjection.authorizingContainerPaths) {
    let projectionKeks: ReadonlyMap<string, Uint8Array>;
    try {
      projectionKeks = await unwrapContainerKekPath({
        execSql: input.execSql,
        projection,
        secretKey: input.secretKey,
        trustedLocalProjection: true,
      });
    } catch (error) {
      throw new Error(
        `Document authorizing container KEK path could not be unwrapped for ${describeProjectionTargetKek(projection)}: ${errorMessage(error)}`,
      );
    }
    for (const [containerKeyEpochId, keyMaterial] of projectionKeks) {
      const existing = keksByEpochId.get(containerKeyEpochId);
      if (existing) {
        assertEqualBytes(
          existing,
          keyMaterial,
          "Document writer projection contains conflicting container KEKs",
        );
        continue;
      }
      keksByEpochId.set(containerKeyEpochId, keyMaterial);
    }
  }

  return keksByEpochId;
}

export async function unwrapDocumentContentKeyFromWriterProjection(input: {
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<Uint8Array> {
  const keksByEpochId = await collectContainerKeksForDocumentSync(input);
  let contentKey: Uint8Array | null = null;

  for (const envelope of input.writerProjection.contentKeyBundle.targets) {
    const containerKek = keksByEpochId.get(envelope.containerKeyEpochId);
    if (!containerKek) {
      continue;
    }
    const unwrapped = await unwrapDocumentContentKeyTarget({
      containerKek,
      envelope,
    });
    if (contentKey) {
      assertEqualBytes(
        contentKey,
        unwrapped,
        "Document content-key targets unwrap to conflicting keys",
      );
      continue;
    }
    contentKey = unwrapped;
  }

  if (!contentKey) {
    throw new Error(
      `Document content key could not be unwrapped from any of ${input.writerProjection.contentKeyBundle.targets.length} target(s)`,
    );
  }
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }

  return contentKey;
}
