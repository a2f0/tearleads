import {
  type AccessEventV2,
  type AccessManifestV2,
  CONTENT_RECORD_ENCRYPTION_SUITE_V2,
  type ContainerKeyWrapV2,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  computeWriteHeaderHash,
  type DocumentContentKeyTargetV2,
  type DocumentLinkAccessEventBodyV2,
  type DocumentLinkSetManifestStateV2,
  decryptWithDek,
  deriveDocumentLinkSetManifest,
  encryptWithDek,
  type KeyingV2CanonicalJson,
  serializeKeyingV2CanonicalJson,
  signAccessEvent,
  signWriteHeader,
  type UnsignedAccessEventV2,
  type UnsignedWriteHeaderV2,
  verifyWriteHeader,
  type WriteHeaderV2,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  DocumentV2ContentKeyTargetEnvelope,
  DocumentV2CreateRequest,
  DocumentV2OutgoingUpdate,
  DocumentV2SyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
  DocumentV2SyncResponse,
} from "@tearleads/validators/response";
import type { DocumentRecord } from "../persistence/documentPersistence";
import type { ExecSql } from "../persistence/sqlSchema";
import { unwrapRecipientEnvelopesWithPrincipalPolicies } from "../principalPolicyCrypto";

const DOCUMENT_V2_CONTENT_KEY_WRAP_SUITE =
  "tearleads.document-v2.content-key-wrap.aes-256-gcm-container-kek.v1";

export interface DocumentV2CreateAuthor {
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

interface BuildDocumentV2CreatePlanInput {
  author: DocumentV2CreateAuthor;
  containerProjection: ContainerV2WriterProjectionResponse;
  contentKeyEpoch?: number;
  documentId?: string;
  eventId?: string;
  signedAt?: string;
  targetEnvelopes: readonly DocumentV2ContentKeyTargetEnvelope[];
}

export interface DocumentV2CreatePlan {
  body: DocumentLinkAccessEventBodyV2;
  documentId: string;
  event: AccessEventV2;
  eventHash: string;
  manifest: AccessManifestV2;
  manifestHash: string;
  request: DocumentV2CreateRequest;
  state: DocumentLinkSetManifestStateV2;
  targetHash: string;
  targets: DocumentContentKeyTargetV2[];
}

interface MaterializedDocumentV2CreatePlan {
  contentKey: Uint8Array;
  plan: DocumentV2CreatePlan;
}

interface DocumentV2CreateApi {
  createDocumentV2(
    input: DocumentV2CreateRequest,
  ): Promise<DocumentV2CreateResponse | null>;
  getContainerV2WriterProjection(
    containerId: string,
  ): Promise<ContainerV2WriterProjectionResponse | null>;
}

interface CreateRemoteDocumentV2Result {
  contentKey: Uint8Array;
  documentId: string;
  persistedState: PersistedDocumentV2CreateState;
  plan: DocumentV2CreatePlan;
  response: DocumentV2CreateResponse;
}

interface DocumentV2SyncPreparedUpdate {
  checkpointKind?: DocumentV2OutgoingUpdate["checkpointKind"] | undefined;
  ciphertextHash: string;
  contentRecordId?: string | undefined;
  encryptedData: string;
  id: string;
  metadataHash: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  signedAt?: string | undefined;
  sourceVersionVector?: string | undefined;
}

interface BuildDocumentV2SyncPlanInput {
  author: DocumentV2CreateAuthor;
  authorizingContainerPaths?: readonly (readonly Record<string, unknown>[])[];
  contentKeyBundle: DocumentV2CreateResponse["contentKeyBundle"];
  documentId?: string | undefined;
  documentKekTargets: DocumentV2SyncResponse["documentKekTargets"];
  documentManifest: DocumentV2CreateResponse["accessManifest"];
  includeContentKeyBundle?: boolean | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  outgoingUpdates?: readonly DocumentV2SyncPreparedUpdate[] | undefined;
  signedAt?: string | undefined;
}

interface DocumentV2SyncPlan {
  contentKeyEpoch: number;
  documentId: string;
  documentKekTargets: DocumentV2SyncResponse["documentKekTargets"];
  documentManifest: DocumentV2CreateResponse["accessManifest"];
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
  request: DocumentV2SyncRequest;
  sourceContentKeyBundle: DocumentV2CreateResponse["contentKeyBundle"];
}

interface SyncRemoteDocumentV2Result {
  persistedState: PersistedDocumentV2SyncState;
  plan: DocumentV2SyncPlan;
  response: DocumentV2SyncResponse;
}

interface DocumentV2SyncApi {
  syncDocumentV2(
    documentId: string,
    input: DocumentV2SyncRequest,
  ): Promise<DocumentV2SyncResponse | null>;
}

type PersistedDocumentV2CreateState = Pick<
  DocumentRecord,
  | "documentId"
  | "v2ContentKeyBundle"
  | "v2DocumentKekTargets"
  | "v2DocumentManifestBundle"
>;

type PersistedDocumentV2SyncState = PersistedDocumentV2CreateState;

interface UnwrappedContainerKek {
  containerId: string;
  keyEpochHash: string;
  keyMaterial: Uint8Array;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecordString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function readManifestContainerId(
  bundle: ContainerV2WriterProjectionResponse["path"][number],
): string | null {
  const containerId = isPlainRecord(bundle.state)
    ? Reflect.get(bundle.state, "containerId")
    : undefined;

  return isPlainRecord(bundle.state) && typeof containerId === "string"
    ? containerId
    : null;
}

function targetKey(target: DocumentContentKeyTargetV2): string {
  return [
    target.containerId,
    target.containerManifestHash,
    target.containerKeyEpochId,
    String(target.containerKeyEpoch),
  ].join(":");
}

function sortDocumentTargets<T extends DocumentContentKeyTargetV2>(
  targets: readonly T[],
): T[] {
  return [...targets].sort((left, right) =>
    targetKey(left).localeCompare(targetKey(right)),
  );
}

function readRecordNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label}.${key} must be a positive integer`);
  }
  return value as number;
}

function readRecordNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string or null`);
  }
  return value;
}

function normalizeContainerKeyWrap(value: unknown): ContainerKeyWrapV2 {
  if (!isPlainRecord(value)) {
    throw new Error("Container writer projection KEK wrap is invalid");
  }

  const recipientKind = readRecordString(
    value,
    "recipientKind",
    "container KEK wrap",
  );
  if (
    recipientKind !== "user" &&
    recipientKind !== "group" &&
    recipientKind !== "organization" &&
    recipientKind !== "container"
  ) {
    throw new Error(
      "Container writer projection KEK wrap recipient is invalid",
    );
  }

  return {
    containerKeyEpochId: readRecordString(
      value,
      "containerKeyEpochId",
      "container KEK wrap",
    ),
    recipientKind,
    recipientId: readRecordString(value, "recipientId", "container KEK wrap"),
    recipientKeyEpochId: readRecordString(
      value,
      "recipientKeyEpochId",
      "container KEK wrap",
    ),
    recipientKeyFingerprint: readRecordString(
      value,
      "recipientKeyFingerprint",
      "container KEK wrap",
    ),
    kemCipherText: readRecordString(
      value,
      "kemCipherText",
      "container KEK wrap",
    ),
    wrappedKey: readRecordString(value, "wrappedKey", "container KEK wrap"),
    wrapManifestHash: readRecordString(
      value,
      "wrapManifestHash",
      "container KEK wrap",
    ),
  };
}

export function deriveDocumentV2CreateTargets(
  projection: ContainerV2WriterProjectionResponse,
): DocumentContentKeyTargetV2[] {
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

function projectionKekLabel(index: number): string {
  return `Container writer projection KEK[${index}]`;
}

function assertProjectionKekMatchesPath(
  projection: ContainerV2WriterProjectionResponse,
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
    readRecordString(
      kek.keyEpoch,
      "accessManifestHash",
      projectionKekLabel(index),
    ) !== kek.accessManifestHash ||
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
  wraps: readonly ContainerKeyWrapV2[];
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
    return await unwrapRecipientEnvelopesWithPrincipalPolicies({
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
  wraps: readonly ContainerKeyWrapV2[];
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

export async function unwrapContainerV2KekPath(input: {
  execSql?: ExecSql | undefined;
  projection: ContainerV2WriterProjectionResponse;
  secretKey: Uint8Array;
}): Promise<ReadonlyMap<string, Uint8Array>> {
  if (input.projection.path.length !== input.projection.containerKeks.length) {
    throw new Error(
      "Container writer projection path and KEKs are inconsistent",
    );
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

    const wraps: ContainerKeyWrapV2[] = [];
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
      throw new Error(`${projectionKekLabel(index)} could not be unwrapped`);
    }
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
  return keyMaterialByEpochId;
}

function getOnlyDocumentV2CreateTarget(
  projection: ContainerV2WriterProjectionResponse,
): DocumentContentKeyTargetV2 {
  const target = deriveDocumentV2CreateTargets(projection)[0];
  if (!target) {
    throw new Error("Document V2 create target is unavailable");
  }
  return target;
}

async function wrapDocumentV2ContentKeyForCreate(input: {
  contentKey: Uint8Array;
  execSql?: ExecSql | undefined;
  projection: ContainerV2WriterProjectionResponse;
  secretKey: Uint8Array;
}): Promise<DocumentV2ContentKeyTargetEnvelope[]> {
  const target = getOnlyDocumentV2CreateTarget(input.projection);
  const keksByEpochId = await unwrapContainerV2KekPath({
    execSql: input.execSql,
    projection: input.projection,
    secretKey: input.secretKey,
  });
  const targetKek = keksByEpochId.get(target.containerKeyEpochId);
  if (!targetKek) {
    throw new Error("Document V2 create target KEK could not be unwrapped");
  }

  const wrapped = await encryptWithDek(input.contentKey, targetKek);

  return [
    {
      ...target,
      wrappedKey: bytesToBase64(wrapped.ciphertext),
      wrappingMetadata: {
        suite: DOCUMENT_V2_CONTENT_KEY_WRAP_SUITE,
        iv: bytesToBase64(wrapped.iv),
      },
    },
  ];
}

export async function unwrapDocumentV2ContentKeyTarget(input: {
  containerKek: Uint8Array;
  envelope: DocumentV2ContentKeyTargetEnvelope;
}): Promise<Uint8Array> {
  const metadata = input.envelope.wrappingMetadata;
  const suite = isPlainRecord(metadata)
    ? Reflect.get(metadata, "suite")
    : undefined;
  const iv = isPlainRecord(metadata) ? Reflect.get(metadata, "iv") : undefined;
  if (suite !== DOCUMENT_V2_CONTENT_KEY_WRAP_SUITE) {
    throw new Error("Document V2 content-key target uses an unknown suite");
  }
  if (typeof iv !== "string" || iv.length === 0) {
    throw new Error("Document V2 content-key target is missing an IV");
  }

  return decryptWithDek(
    {
      iv: base64ToBytes(iv),
      ciphertext: base64ToBytes(input.envelope.wrappedKey),
    },
    input.containerKek,
  );
}

function mergeTargetEnvelopes(
  targets: readonly DocumentContentKeyTargetV2[],
  envelopes: readonly DocumentV2ContentKeyTargetEnvelope[],
): DocumentV2ContentKeyTargetEnvelope[] {
  const expectedByKey = new Map(
    targets.map((target) => [targetKey(target), target]),
  );
  const envelopeByKey = new Map<string, DocumentV2ContentKeyTargetEnvelope>();

  for (const envelope of envelopes) {
    const key = targetKey(envelope);
    if (!expectedByKey.has(key)) {
      throw new Error("Document V2 content-key target envelope is unexpected");
    }
    if (envelopeByKey.has(key)) {
      throw new Error("Document V2 content-key target envelope is duplicated");
    }
    if (envelope.wrappedKey.length === 0) {
      throw new Error("Document V2 content-key target envelope is empty");
    }
    if (!isPlainRecord(envelope.wrappingMetadata)) {
      throw new Error(
        "Document V2 content-key target wrapping metadata must be an object",
      );
    }
    envelopeByKey.set(key, envelope);
  }

  return sortDocumentTargets(targets).map((target) => {
    const envelope = envelopeByKey.get(targetKey(target));
    if (!envelope) {
      throw new Error("Document V2 content-key target envelope is missing");
    }
    return envelope;
  });
}

export async function buildDocumentV2CreatePlan({
  author,
  containerProjection,
  contentKeyEpoch = 1,
  documentId = crypto.randomUUID(),
  eventId = crypto.randomUUID(),
  signedAt = new Date().toISOString(),
  targetEnvelopes,
}: BuildDocumentV2CreatePlanInput): Promise<DocumentV2CreatePlan> {
  if (author.organizationId !== containerProjection.organizationId) {
    throw new Error("Document V2 author organization does not match container");
  }

  const targets = deriveDocumentV2CreateTargets(containerProjection);
  const targetEnvelopesForRequest = mergeTargetEnvelopes(
    targets,
    targetEnvelopes,
  );
  const targetContainerManifestHash = targets[0]?.containerManifestHash;
  const targetContainerId = targets[0]?.containerId;
  if (!targetContainerManifestHash || !targetContainerId) {
    throw new Error("Document V2 create target is unavailable");
  }

  const body: DocumentLinkAccessEventBodyV2 = {
    eventType: "document.link",
    containerId: targetContainerId,
    containerManifestHash: targetContainerManifestHash,
  };
  const bodyHash = await computeAccessEventBodyHash(
    body as unknown as KeyingV2CanonicalJson,
  );
  const unsignedEvent: UnsignedAccessEventV2 = {
    version: 2,
    eventId,
    eventType: "document.link",
    objectKind: "document",
    objectId: documentId,
    organizationId: author.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: [targetContainerManifestHash],
    bodyHash,
    signerUserId: author.signerUserId,
    signerDeviceId: author.signerDeviceId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signedAt,
  };
  const event = await signAccessEvent(unsignedEvent, author.signerPrivateKey);
  const eventHash = await computeAccessEventHash(event);
  const state: DocumentLinkSetManifestStateV2 = {
    version: 2,
    documentId,
    organizationId: author.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [targetContainerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash(targets);

  return {
    body,
    documentId,
    event,
    eventHash,
    manifest,
    manifestHash,
    request: {
      event: event as unknown as Record<string, unknown>,
      body: body as unknown as Record<string, unknown>,
      expectedManifestHash: manifestHash,
      manifest: manifest as unknown as Record<string, unknown>,
      previousManifest: null,
      targetContainerPath: containerProjection.path.map(
        (bundle) => bundle as unknown as Record<string, unknown>,
      ),
      contentKeyBundle: {
        contentKeyEpoch,
        linkSetManifestHash: manifestHash,
        targetHash,
        targets: targetEnvelopesForRequest,
      },
    },
    state,
    targetHash,
    targets: sortDocumentTargets(targets),
  };
}

export async function buildMaterializedDocumentV2CreatePlan(input: {
  author: DocumentV2CreateAuthor;
  containerProjection: ContainerV2WriterProjectionResponse;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<MaterializedDocumentV2CreatePlan> {
  const contentKey =
    input.contentKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (contentKey.byteLength !== 32) {
    throw new Error("Document V2 content key must be 32 bytes");
  }
  const targetEnvelopes = await wrapDocumentV2ContentKeyForCreate({
    contentKey,
    execSql: input.execSql,
    projection: input.containerProjection,
    secretKey: input.targetSecretKey,
  });
  const plan = await buildDocumentV2CreatePlan({
    author: input.author,
    containerProjection: input.containerProjection,
    ...(input.contentKeyEpoch === undefined
      ? {}
      : { contentKeyEpoch: input.contentKeyEpoch }),
    ...(input.documentId === undefined ? {} : { documentId: input.documentId }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
    targetEnvelopes,
  });

  return {
    contentKey,
    plan,
  };
}

export async function createRemoteDocumentV2(input: {
  apiClient: DocumentV2CreateApi;
  author: DocumentV2CreateAuthor;
  containerId: string;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<CreateRemoteDocumentV2Result | null> {
  const containerProjection =
    await input.apiClient.getContainerV2WriterProjection(input.containerId);
  if (!containerProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedDocumentV2CreatePlan({
    author: input.author,
    containerProjection,
    contentKey: input.contentKey,
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    eventId: input.eventId,
    execSql: input.execSql,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
  });
  const response = await input.apiClient.createDocumentV2(
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }
  const persistedState = persistedDocumentV2CreateStateFromResponse(
    materializedPlan.plan,
    response,
  );

  return {
    contentKey: materializedPlan.contentKey,
    documentId: response.id,
    persistedState,
    plan: materializedPlan.plan,
    response,
  };
}

function contentKeyBundleForSyncRequest(
  bundle: DocumentV2CreateResponse["contentKeyBundle"],
): NonNullable<DocumentV2SyncRequest["contentKeyBundle"]> {
  return {
    contentKeyEpoch: bundle.contentKeyEpoch,
    linkSetManifestHash: bundle.linkSetManifestHash,
    targetHash: bundle.targetHash,
    targets: bundle.targets.map((target) => ({
      containerId: target.containerId,
      containerManifestHash: target.containerManifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      containerKeyEpoch: target.containerKeyEpoch,
      wrappedKey: target.wrappedKey,
      wrappingMetadata: target.wrappingMetadata,
    })),
  };
}

function manifestBundleForSyncRequest(
  bundle: DocumentV2CreateResponse["accessManifest"],
): NonNullable<DocumentV2SyncRequest["documentManifest"]> {
  return {
    event: bundle.event,
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
    state: bundle.state,
  };
}

function readDocumentV2Target(
  value: Record<string, unknown>,
  label: string,
): DocumentContentKeyTargetV2 {
  return {
    containerId: readRecordString(value, "containerId", label),
    containerManifestHash: readRecordString(
      value,
      "containerManifestHash",
      label,
    ),
    containerKeyEpochId: readRecordString(value, "containerKeyEpochId", label),
    containerKeyEpoch: readRecordNumber(value, "containerKeyEpoch", label),
  };
}

function normalizeDocumentV2KekTargetResponse(
  targets: DocumentV2SyncResponse["documentKekTargets"],
): DocumentContentKeyTargetV2[] {
  return sortDocumentTargets(
    targets.targets.map((target, index) => {
      if (!isPlainRecord(target)) {
        throw new Error(`Document V2 KEK target[${index}] is invalid`);
      }
      return readDocumentV2Target(target, `Document V2 KEK target[${index}]`);
    }),
  );
}

function targetEnvelopeReference(
  envelope: DocumentV2CreateResponse["contentKeyBundle"]["targets"][number],
): DocumentContentKeyTargetV2 {
  return {
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

async function assertDocumentV2ManifestBundleConsistent(input: {
  bundle: DocumentV2CreateResponse["accessManifest"];
  label: string;
}): Promise<{ documentId: string; organizationId: string }> {
  const manifestHash = await computeAccessManifestHash(
    input.bundle.manifest as unknown as AccessManifestV2,
  );
  if (manifestHash !== input.bundle.manifestHash) {
    throw new Error(`${input.label} manifest hash mismatch`);
  }

  const eventBundle = input.bundle.event;
  if (!isPlainRecord(eventBundle)) {
    throw new Error(`${input.label} event bundle is invalid`);
  }
  const eventHash = readRecordString(eventBundle, "eventHash", input.label);
  const event = Reflect.get(eventBundle, "event");
  if (!isPlainRecord(event)) {
    throw new Error(`${input.label} signed event is invalid`);
  }
  const computedEventHash = await computeAccessEventHash(
    event as unknown as AccessEventV2,
  );
  if (computedEventHash !== eventHash) {
    throw new Error(`${input.label} event hash mismatch`);
  }

  const state = input.bundle.state;
  if (!isPlainRecord(state)) {
    throw new Error(`${input.label} state is invalid`);
  }
  if (readRecordString(state, "eventHash", input.label) !== eventHash) {
    throw new Error(`${input.label} state event hash mismatch`);
  }

  return {
    documentId: readRecordString(state, "documentId", input.label),
    organizationId: readRecordString(state, "organizationId", input.label),
  };
}

async function resolveDocumentV2SyncIdentity(
  input: BuildDocumentV2SyncPlanInput,
): Promise<{
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
}> {
  const manifestIdentity = await assertDocumentV2ManifestBundleConsistent({
    bundle: input.documentManifest,
    label: "Document V2 sync manifest",
  });
  const documentId = input.documentId ?? input.contentKeyBundle.documentId;
  if (documentId.length === 0) {
    throw new Error("Document V2 sync document id is empty");
  }
  if (
    input.contentKeyBundle.documentId !== documentId ||
    input.documentKekTargets.documentId !== documentId ||
    manifestIdentity.documentId !== documentId
  ) {
    throw new Error("Document V2 sync state document id mismatch");
  }
  if (manifestIdentity.organizationId !== input.author.organizationId) {
    throw new Error("Document V2 sync author organization mismatch");
  }
  if (
    input.documentManifest.manifestHash !==
      input.contentKeyBundle.linkSetManifestHash ||
    input.documentKekTargets.linkSetManifestHash !==
      input.contentKeyBundle.linkSetManifestHash
  ) {
    throw new Error("Document V2 sync link manifest mismatch");
  }
  if (
    input.documentKekTargets.documentKeyTargetHash !==
    input.contentKeyBundle.targetHash
  ) {
    throw new Error("Document V2 sync target hash mismatch");
  }

  const kekTargets = normalizeDocumentV2KekTargetResponse(
    input.documentKekTargets,
  );
  const contentKeyTargets = sortDocumentTargets(
    input.contentKeyBundle.targets.map(targetEnvelopeReference),
  );
  if (
    serializeCanonical(kekTargets, "KEK targets") !==
    serializeCanonical(contentKeyTargets, "content-key targets")
  ) {
    throw new Error("Document V2 sync content-key targets mismatch");
  }

  const targetHash = await computeDocumentContentKeyTargetHash(kekTargets);
  if (targetHash !== input.contentKeyBundle.targetHash) {
    throw new Error("Document V2 sync target hash is not canonical");
  }

  return {
    documentId,
    expectedLinkSetManifestHash: input.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: input.contentKeyBundle.targetHash,
    organizationId: manifestIdentity.organizationId,
  };
}

function normalizeAuthorizingContainerPaths(
  paths: readonly (readonly Record<string, unknown>[])[] | undefined,
): Record<string, unknown>[][] {
  if (!paths || paths.length === 0) {
    throw new Error("Document V2 sync write authorization paths are missing");
  }

  return paths.map((path, pathIndex) => {
    if (path.length === 0) {
      throw new Error(
        `Document V2 sync write authorization path[${pathIndex}] is empty`,
      );
    }
    return path.map((bundle, bundleIndex) => {
      if (!isPlainRecord(bundle)) {
        throw new Error(
          `Document V2 sync write authorization path[${pathIndex}][${bundleIndex}] is invalid`,
        );
      }
      return bundle;
    });
  });
}

async function signDocumentV2OutgoingUpdate(input: {
  author: DocumentV2CreateAuthor;
  contentKeyEpoch: number;
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
  signedAt: string;
  update: DocumentV2SyncPreparedUpdate;
}): Promise<DocumentV2OutgoingUpdate> {
  const contentRecordId = input.update.contentRecordId ?? input.update.id;
  const nonceDomain = {
    version: 2,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId,
  } as const;
  const unsignedHeader: UnsignedWriteHeaderV2 = {
    ...nonceDomain,
    accessManifestHash: input.expectedLinkSetManifestHash,
    targetHash: input.expectedTargetHash,
    nonceDomainHash: await computeContentRecordNonceDomainHash(nonceDomain),
    metadataHash: input.update.metadataHash,
    ciphertextHash: input.update.ciphertextHash,
    writerUserId: input.author.signerUserId,
    writerDeviceId: input.author.signerDeviceId,
    writerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.update.signedAt ?? input.signedAt,
  };
  const writeHeader = await signWriteHeader(
    unsignedHeader,
    input.author.signerPrivateKey,
  );

  return {
    ...(input.update.checkpointKind === undefined
      ? {}
      : { checkpointKind: input.update.checkpointKind }),
    id: input.update.id,
    encryptedData: input.update.encryptedData,
    partialStartVersionVector: input.update.partialStartVersionVector,
    partialEndVersionVector: input.update.partialEndVersionVector,
    ...(input.update.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: input.update.sourceVersionVector }),
    writeHeader: writeHeader as unknown as Record<string, unknown>,
  };
}

function assertUniqueDocumentV2OutgoingUpdates(
  updates: readonly DocumentV2SyncPreparedUpdate[],
): void {
  const updateIds = new Set<string>();
  const contentRecordIds = new Set<string>();
  for (const update of updates) {
    if (updateIds.has(update.id)) {
      throw new Error("Document V2 sync update id is duplicated");
    }
    updateIds.add(update.id);

    const contentRecordId = (update.contentRecordId ?? update.id).toLowerCase();
    if (contentRecordIds.has(contentRecordId)) {
      throw new Error("Document V2 sync content record id is duplicated");
    }
    contentRecordIds.add(contentRecordId);
  }
}

export async function buildDocumentV2SyncPlan(
  input: BuildDocumentV2SyncPlanInput,
): Promise<DocumentV2SyncPlan> {
  const {
    documentId,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    organizationId,
  } = await resolveDocumentV2SyncIdentity(input);
  const outgoingUpdateInputs = [...(input.outgoingUpdates ?? [])];
  const signedAt = input.signedAt ?? new Date().toISOString();
  assertUniqueDocumentV2OutgoingUpdates(outgoingUpdateInputs);

  const outgoingUpdates = await Promise.all(
    outgoingUpdateInputs.map((update) =>
      signDocumentV2OutgoingUpdate({
        author: input.author,
        contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
        documentId,
        expectedLinkSetManifestHash,
        expectedTargetHash,
        organizationId,
        signedAt,
        update,
      }),
    ),
  );
  const request: DocumentV2SyncRequest = {
    ...(input.includeContentKeyBundle === true
      ? {
          contentKeyBundle: contentKeyBundleForSyncRequest(
            input.contentKeyBundle,
          ),
        }
      : {}),
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    ...(outgoingUpdates.length === 0
      ? {}
      : {
          documentManifest: manifestBundleForSyncRequest(
            input.documentManifest,
          ),
          authorizingContainerPaths: normalizeAuthorizingContainerPaths(
            input.authorizingContainerPaths,
          ),
        }),
    expectedLinkSetManifestHash,
    expectedTargetHash,
    localVersionVector: input.localVersionVector,
    ...(input.minLsn === undefined ? {} : { minLsn: input.minLsn }),
    outgoingUpdates,
  };

  return {
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId,
    documentKekTargets: input.documentKekTargets,
    documentManifest: input.documentManifest,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    organizationId,
    request,
    sourceContentKeyBundle: input.contentKeyBundle,
  };
}

function assertAcceptedOutgoingUpdateIdsMatchPlan(
  plan: DocumentV2SyncPlan,
  response: DocumentV2SyncResponse,
): void {
  const expected = plan.request.outgoingUpdates.map((update) => update.id);
  const accepted = response.acceptedOutgoingUpdateIds;
  const expectedSorted = [...expected].sort();
  const acceptedSorted = [...accepted].sort();
  if (
    expectedSorted.length !== acceptedSorted.length ||
    expectedSorted.some((id, index) => id !== acceptedSorted[index])
  ) {
    throw new Error("Document V2 sync response accepted update mismatch");
  }
}

async function assertDocumentV2SyncResponseUpdateMatchesPlan(input: {
  plan: DocumentV2SyncPlan;
  update: DocumentV2SyncResponse["updates"][number];
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<void> {
  const { plan, update } = input;
  if (update.documentId !== plan.documentId) {
    throw new Error("Document V2 sync response update document mismatch");
  }
  if (!isPlainRecord(update.writeHeader)) {
    throw new Error("Document V2 sync response write header is invalid");
  }

  const header = update.writeHeader as unknown as WriteHeaderV2;
  const headerHash = await computeWriteHeaderHash(header);
  if (headerHash !== update.writeHeaderHash) {
    throw new Error("Document V2 sync response write header hash mismatch");
  }
  if (
    readRecordNumber(update.writeHeader, "version", "write header") !== 2 ||
    readRecordString(update.writeHeader, "objectKind", "write header") !==
      "document" ||
    readRecordString(update.writeHeader, "objectId", "write header") !==
      plan.documentId ||
    readRecordString(update.writeHeader, "organizationId", "write header") !==
      plan.organizationId ||
    readRecordString(
      update.writeHeader,
      "accessManifestHash",
      "write header",
    ) !== plan.expectedLinkSetManifestHash ||
    readRecordNumber(update.writeHeader, "contentKeyEpoch", "write header") !==
      plan.contentKeyEpoch ||
    readRecordString(update.writeHeader, "targetHash", "write header") !==
      plan.expectedTargetHash ||
    readRecordString(update.writeHeader, "encryptionSuite", "write header") !==
      CONTENT_RECORD_ENCRYPTION_SUITE_V2 ||
    readRecordString(
      update.writeHeader,
      "writerKeyFingerprint",
      "write header",
    ) !== update.authorFingerprint
  ) {
    throw new Error("Document V2 sync response write header mismatch");
  }

  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 2,
    organizationId: plan.organizationId,
    objectKind: "document",
    objectId: plan.documentId,
    contentKeyEpoch: plan.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId: readRecordString(
      update.writeHeader,
      "contentRecordId",
      "write header",
    ),
  });
  if (
    nonceDomainHash !==
    readRecordString(update.writeHeader, "nonceDomainHash", "write header")
  ) {
    throw new Error("Document V2 sync response nonce domain mismatch");
  }

  const writerPublicKey = input.writerPublicKeysByFingerprint?.get(
    update.authorFingerprint,
  );
  if (!writerPublicKey) {
    return;
  }

  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: plan.expectedLinkSetManifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: plan.documentId,
      organizationId: plan.organizationId,
    },
    expectedTargetHash: plan.expectedTargetHash,
    header,
    writerPublicKey,
  });
  if (!verified.ok || verified.value.headerHash !== update.writeHeaderHash) {
    throw new Error(
      "Document V2 sync response write header signature mismatch",
    );
  }
}

export async function persistedDocumentV2SyncStateFromResponse(
  plan: DocumentV2SyncPlan,
  response: DocumentV2SyncResponse,
  options: {
    writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
  } = {},
): Promise<PersistedDocumentV2SyncState> {
  if (response.documentId !== plan.documentId) {
    throw new Error("Document V2 sync response document id mismatch");
  }
  if (
    serializeCanonical(response.contentKeyBundle, "content-key bundle") !==
    serializeCanonical(plan.sourceContentKeyBundle, "content-key bundle")
  ) {
    throw new Error("Document V2 sync response content-key bundle mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets, "KEK targets") !==
    serializeCanonical(plan.documentKekTargets, "KEK targets")
  ) {
    throw new Error("Document V2 sync response KEK target mismatch");
  }
  assertAcceptedOutgoingUpdateIdsMatchPlan(plan, response);

  await Promise.all(
    response.updates.map((update) =>
      assertDocumentV2SyncResponseUpdateMatchesPlan({
        plan,
        update,
        writerPublicKeysByFingerprint: options.writerPublicKeysByFingerprint,
      }),
    ),
  );

  return {
    documentId: plan.documentId,
    v2ContentKeyBundle: serializeV2State(response.contentKeyBundle),
    v2DocumentKekTargets: serializeV2State(response.documentKekTargets),
    v2DocumentManifestBundle: serializeV2State(plan.documentManifest),
  };
}

export async function syncRemoteDocumentV2(
  input: BuildDocumentV2SyncPlanInput & {
    apiClient: DocumentV2SyncApi;
    writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
  },
): Promise<SyncRemoteDocumentV2Result | null> {
  const plan = await buildDocumentV2SyncPlan(input);
  const response = await input.apiClient.syncDocumentV2(
    plan.documentId,
    plan.request,
  );
  if (!response) {
    return null;
  }

  return {
    persistedState: await persistedDocumentV2SyncStateFromResponse(
      plan,
      response,
      {
        writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
      },
    ),
    plan,
    response,
  };
}

function serializeV2State(value: unknown): string {
  return JSON.stringify(value);
}

function serializeCanonical(value: unknown, label: string): string {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new Error(`Document V2 create response ${label} is invalid`);
  }

  return serializeKeyingV2CanonicalJson(value as KeyingV2CanonicalJson);
}

function assertCreateResponseMatchesPlan(
  plan: DocumentV2CreatePlan,
  response: DocumentV2CreateResponse,
): void {
  if (response.id !== plan.documentId) {
    throw new Error("Document V2 create response id mismatch");
  }
  if (response.accessManifest.manifestHash !== plan.manifestHash) {
    throw new Error("Document V2 create response manifest hash mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.manifest, "manifest") !==
    serializeCanonical(plan.manifest, "manifest")
  ) {
    throw new Error("Document V2 create response manifest mismatch");
  }

  const responseEvent = response.accessManifest.event;
  if (!isPlainRecord(responseEvent)) {
    throw new Error("Document V2 create response event bundle is invalid");
  }
  if (
    readRecordString(responseEvent, "eventHash", "event bundle") !==
    plan.eventHash
  ) {
    throw new Error("Document V2 create response event hash mismatch");
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "event"), "event") !==
    serializeCanonical(plan.event, "event")
  ) {
    throw new Error("Document V2 create response event mismatch");
  }

  const responseState = response.accessManifest.state;
  if (!isPlainRecord(responseState)) {
    throw new Error("Document V2 create response state is invalid");
  }
  if (
    readRecordString(responseState, "documentId", "document state") !==
    plan.documentId
  ) {
    throw new Error("Document V2 create response document id mismatch");
  }
  if (
    serializeCanonical(responseState, "state") !==
    serializeCanonical(plan.state, "state")
  ) {
    throw new Error("Document V2 create response state mismatch");
  }

  if (response.contentKeyBundle.documentId !== plan.documentId) {
    throw new Error(
      "Document V2 create response content-key document mismatch",
    );
  }
  if (
    response.contentKeyBundle.contentKeyEpoch !==
    plan.request.contentKeyBundle.contentKeyEpoch
  ) {
    throw new Error("Document V2 create response content-key epoch mismatch");
  }
  if (response.contentKeyBundle.linkSetManifestHash !== plan.manifestHash) {
    throw new Error("Document V2 create response link manifest mismatch");
  }
  if (response.contentKeyBundle.targetHash !== plan.targetHash) {
    throw new Error("Document V2 create response target hash mismatch");
  }
  if (
    serializeCanonical(
      response.contentKeyBundle.targets,
      "content-key targets",
    ) !==
    serializeCanonical(
      plan.request.contentKeyBundle.targets,
      "content-key targets",
    )
  ) {
    throw new Error("Document V2 create response content-key targets mismatch");
  }
  if (response.documentKekTargets.documentId !== plan.documentId) {
    throw new Error("Document V2 create response target document mismatch");
  }
  if (response.documentKekTargets.linkSetManifestHash !== plan.manifestHash) {
    throw new Error("Document V2 create response target manifest mismatch");
  }
  if (response.documentKekTargets.documentKeyTargetHash !== plan.targetHash) {
    throw new Error(
      "Document V2 create response document target hash mismatch",
    );
  }
  if (
    serializeCanonical(response.documentKekTargets.targets, "KEK targets") !==
    serializeCanonical(plan.targets, "KEK targets")
  ) {
    throw new Error("Document V2 create response KEK targets mismatch");
  }
}

export function persistedDocumentV2CreateStateFromResponse(
  plan: DocumentV2CreatePlan,
  response: DocumentV2CreateResponse,
): PersistedDocumentV2CreateState {
  assertCreateResponseMatchesPlan(plan, response);

  return {
    documentId: response.id,
    v2ContentKeyBundle: serializeV2State(response.contentKeyBundle),
    v2DocumentKekTargets: serializeV2State(response.documentKekTargets),
    v2DocumentManifestBundle: serializeV2State(response.accessManifest),
  };
}
