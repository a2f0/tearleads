import {
  type AccessEventV2,
  type AccessManifestV2,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTargetV2,
  type DocumentLinkAccessEventBodyV2,
  type DocumentLinkSetManifestStateV2,
  deriveDocumentLinkSetManifest,
  type KeyingV2CanonicalJson,
  serializeKeyingV2CanonicalJson,
  signAccessEvent,
  type UnsignedAccessEventV2,
} from "@tearleads/crypto";
import type {
  DocumentV2ContentKeyTargetEnvelope,
  DocumentV2CreateRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
} from "@tearleads/validators/response";
import type { DocumentRecord } from "../persistence/documentPersistence";

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

type PersistedDocumentV2CreateState = Pick<
  DocumentRecord,
  | "documentId"
  | "v2ContentKeyBundle"
  | "v2DocumentKekTargets"
  | "v2DocumentManifestBundle"
>;

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

export function deriveDocumentV2CreateTargets(
  projection: ContainerV2WriterProjectionResponse,
): DocumentContentKeyTargetV2[] {
  const targetManifest =
    projection.path.find(
      (bundle) => readManifestContainerId(bundle) === projection.containerId,
    ) ?? projection.path[projection.path.length - 1];
  if (!targetManifest) {
    throw new Error("Container writer projection path is empty");
  }

  if (
    readManifestContainerId(targetManifest) !== null &&
    readManifestContainerId(targetManifest) !== projection.containerId
  ) {
    throw new Error("Container writer projection target path is inconsistent");
  }

  const targetKeks = projection.containerKeks.filter(
    (kek) => kek.containerId === projection.containerId,
  );
  if (targetKeks.length !== 1) {
    throw new Error("Container writer projection must include one target KEK");
  }

  const targetKek = targetKeks[0];
  if (!targetKek) {
    throw new Error("Container writer projection target KEK is unavailable");
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
