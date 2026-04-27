import {
  type AccessEventV2,
  type AccessManifestV2,
  type ContainerKeyWrapV2,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTargetV2,
  type DocumentLinkAccessEventBodyV2,
  type DocumentLinkSetManifestStateV2,
  decryptWithDek,
  deriveDocumentLinkSetManifest,
  encryptWithDek,
  type KeyingV2CanonicalJson,
  serializeKeyingV2CanonicalJson,
  signAccessEvent,
  type UnsignedAccessEventV2,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  DocumentV2ContentKeyTargetEnvelope,
  DocumentV2CreateRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
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

type PersistedDocumentV2CreateState = Pick<
  DocumentRecord,
  | "documentId"
  | "v2ContentKeyBundle"
  | "v2DocumentKekTargets"
  | "v2DocumentManifestBundle"
>;

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
