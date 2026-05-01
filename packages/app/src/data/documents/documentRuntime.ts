import {
  type AccessEvent,
  type AccessManifest,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type ContainerKeyWrap,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeWriteHeaderHash,
  type DocumentContentKeyTarget,
  type DocumentLinkAccessEventBody,
  type DocumentLinkSetManifestState,
  type DocumentUnlinkAccessEventBody,
  decryptWithDek,
  deriveDocumentLinkSetManifest,
  encryptWithDek,
  type KeyingCanonicalJson,
  serializeKeyingCanonicalJson,
  signAccessEvent,
  signWriteHeader,
  type UnsignedAccessEvent,
  type UnsignedWriteHeader,
  verifyWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  DocumentContentKeyTargetEnvelope,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { parseWalLsn } from "@tearleads/validators/util";
import {
  readCanonicalJson,
  readCanonicalRecord,
  readCanonicalRecordPaths,
  readCanonicalRecords,
} from "../keyingCanonicalJson";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../persistence/documentPersistence";
import type { ExecSql } from "../persistence/sqlSchema";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../principalPolicyCrypto";

const DOCUMENT_CONTENT_KEY_WRAP_SUITE =
  "tearleads.document.content-key-wrap.aes-256-gcm-container-kek";
const DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT = "tearleads.document.loro-update";
const DOCUMENT_CONTENT_RECORD_KEY_INFO_DOMAIN =
  "tearleads.document.content-record-key-info";
const DOCUMENT_CONTENT_RECORD_AAD_DOMAIN =
  "tearleads.document.content-record-aad";
const DOCUMENT_CONTENT_RECORD_HKDF_SALT: Uint8Array<ArrayBuffer> =
  new TextEncoder().encode("tearleads.document.content-record-hkdf-salt");
const DOCUMENT_CONTENT_RECORD_IV: Uint8Array<ArrayBuffer> = new Uint8Array(12);
const DOCUMENT_ENCRYPTED_UPDATE_KEYS = new Set([
  "ciphertext",
  "contentKeyEpoch",
  "contentRecordId",
  "encryptionSuite",
  "format",
  "iv",
  "metadataHash",
  "nonceDomainHash",
  "version",
]);
const TEXT_ENCODER = new TextEncoder();

export interface DocumentCreateAuthor {
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

interface BuildDocumentCreatePlanInput {
  author: DocumentCreateAuthor;
  containerProjection: ContainerWriterProjectionResponse;
  contentKeyEpoch?: number;
  documentId?: string;
  eventId?: string;
  signedAt?: string;
  targetEnvelopes: readonly DocumentContentKeyTargetEnvelope[];
}

export interface DocumentCreatePlan {
  body: DocumentLinkAccessEventBody;
  documentId: string;
  event: AccessEvent;
  eventHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  request: DocumentCreateRequest;
  state: DocumentLinkSetManifestState;
  targetHash: string;
  targets: DocumentContentKeyTarget[];
}

interface MaterializedDocumentCreatePlan {
  contentKey: Uint8Array;
  plan: DocumentCreatePlan;
}

interface DocumentCreateApi {
  createDocument(
    input: DocumentCreateRequest,
  ): Promise<DocumentCreateResponse | null>;
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
}

interface CreateRemoteDocumentResult {
  contentKey: Uint8Array;
  documentId: string;
  persistedState: PersistedDocumentCreateState;
  plan: DocumentCreatePlan;
  response: DocumentCreateResponse;
}

type DocumentLinkSetMutationOperation = "link" | "unlink";
type DocumentLinkSetMutationBody =
  | DocumentLinkAccessEventBody
  | DocumentUnlinkAccessEventBody;

interface DocumentLinkSetTargetState {
  readonly currentTargets: readonly DocumentContentKeyTarget[];
  readonly linkedContainerIds: readonly string[];
  readonly target: DocumentContentKeyTarget;
  readonly targets: readonly DocumentContentKeyTarget[];
}

interface BuildDocumentLinkSetMutationPlanInput {
  author: DocumentCreateAuthor;
  contentKeyEpoch: number;
  eventId?: string | undefined;
  operation: DocumentLinkSetMutationOperation;
  signedAt?: string | undefined;
  targetContainerProjection: ContainerWriterProjectionResponse;
  targetEnvelopes: readonly DocumentContentKeyTargetEnvelope[];
  writerProjection: DocumentWriterProjectionResponse;
}

export interface DocumentLinkSetMutationPlan {
  body: DocumentLinkSetMutationBody;
  contentKeyEpoch: number;
  documentId: string;
  event: AccessEvent;
  eventHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  operation: DocumentLinkSetMutationOperation;
  request: DocumentLinkSetMutationRequest;
  state: DocumentLinkSetManifestState;
  targetHash: string;
  targets: DocumentContentKeyTarget[];
}

interface MaterializedDocumentLinkSetMutationPlan {
  contentKey: Uint8Array;
  contentKeyRotated: boolean;
  plan: DocumentLinkSetMutationPlan;
}

interface DocumentLinkSetEventPlan {
  authorizingContainerPaths: Record<string, unknown>[][];
  body: DocumentLinkSetMutationBody;
  event: AccessEvent;
  eventHash: string;
}

interface DocumentLinkSetMutationApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  linkDocument(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
  ): Promise<DocumentLinkSetMutationResponse | null>;
  unlinkDocument(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
  ): Promise<DocumentLinkSetMutationResponse | null>;
}

export interface RelinkRemoteDocumentResult {
  contentKey: Uint8Array;
  contentKeyRotated: boolean;
  documentId: string;
  linkedContainerIds: readonly string[];
  persistedState: PersistedDocumentCreateState;
  plan: DocumentLinkSetMutationPlan;
  response: DocumentLinkSetMutationResponse;
}

interface DocumentSyncPreparedUpdate {
  checkpointKind?: DocumentOutgoingUpdate["checkpointKind"] | undefined;
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

interface DocumentEncryptedPendingUpdate {
  contentRecordId: string;
  encryptedData: string;
  metadataHash: string;
  ciphertextHash: string;
}

interface ParsedDocumentEncryptedUpdate {
  ciphertext: Uint8Array;
  contentKeyEpoch: number;
  contentRecordId: string;
  metadataHash: string;
  nonceDomainHash: string;
  iv: Uint8Array;
}

interface DecryptedDocumentSyncUpdate {
  id: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  updateData: Uint8Array;
}

interface BuildDocumentSyncPlanInput {
  author: DocumentCreateAuthor;
  authorizingContainerPaths?: readonly (readonly Record<string, unknown>[])[];
  contentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
  documentId?: string | undefined;
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
  localVersionVector: string | null;
  minLsn?: string | undefined;
  outgoingUpdates?: readonly DocumentSyncPreparedUpdate[] | undefined;
  signedAt?: string | undefined;
}

interface DocumentSyncPlan {
  contentKeyEpoch: number;
  documentId: string;
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  minLsn?: string | undefined;
  organizationId: string;
  request: DocumentSyncRequest;
  sourceContentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
}

interface MaterializedDocumentSyncPlan {
  contentKey: Uint8Array;
  plan: DocumentSyncPlan;
}

interface SyncRemoteDocumentResult {
  contentKey: Uint8Array;
  decryptedUpdates: DecryptedDocumentSyncUpdate[];
  persistedState: PersistedDocumentSyncState;
  plan: DocumentSyncPlan;
  response: DocumentSyncResponse;
  writerProjection: DocumentWriterProjectionResponse;
}

interface DocumentSyncSubmitFailure {
  readonly message: string;
  readonly ok: false;
  readonly report: () => void;
  readonly status: number | null;
}

interface DocumentSyncSubmitSuccess {
  readonly ok: true;
  readonly response: DocumentSyncResponse;
}

type DocumentSyncSubmitResult =
  | DocumentSyncSubmitFailure
  | DocumentSyncSubmitSuccess;

interface DocumentSyncApi {
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  syncDocument(
    documentId: string,
    input: DocumentSyncRequest,
  ): Promise<DocumentSyncResponse | null>;
  syncDocumentResult?(
    documentId: string,
    input: DocumentSyncRequest,
    options?: { readonly reportErrors?: boolean | undefined },
  ): Promise<
    | {
        readonly data: DocumentSyncResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
}

type DocumentWriterPublicKeyResolver = (input: {
  authorFingerprint: string;
  header: WriteHeader;
  update: DocumentSyncResponse["updates"][number];
}) => Promise<Uint8Array | null>;

type PersistedDocumentCreateState = Pick<
  DocumentRecord,
  | "documentId"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle"
>;

type PersistedDocumentSyncState = PersistedDocumentCreateState;

interface UnwrappedContainerKek {
  containerId: string;
  keyEpochHash: string;
  keyMaterial: Uint8Array;
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

function readRecordValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return record[key];
}

function readRecordInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label}.${key} must be an integer`);
  }
  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`${label} must be a string array`);
  }

  return [...value];
}

function isAccessEventType(value: unknown): value is AccessEvent["eventType"] {
  return (
    value === "attachment.bind" ||
    value === "attachment.detach" ||
    value === "container.create" ||
    value === "container.grant" ||
    value === "container.move" ||
    value === "container.rekey" ||
    value === "container.revoke" ||
    value === "document.link" ||
    value === "document.unlink"
  );
}

function isAccessObjectKind(
  value: unknown,
): value is AccessEvent["objectKind"] {
  return value === "blob" || value === "container" || value === "document";
}

function isContentObjectKind(
  value: unknown,
): value is WriteHeader["objectKind"] {
  return value === "blob" || value === "document";
}

function readAccessEvent(value: unknown, label: string): AccessEvent {
  const record = readCanonicalRecord(value, label);
  const eventType = readRecordValue(record, "eventType");
  const objectKind = readRecordValue(record, "objectKind");
  if (!isAccessEventType(eventType)) {
    throw new Error(`${label}.eventType is invalid`);
  }
  if (!isAccessObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }

  return {
    version: 1,
    eventId: readRecordString(record, "eventId", label),
    eventType,
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    organizationId: readRecordString(record, "organizationId", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    dependencyManifestHashes: readStringArray(
      readRecordValue(record, "dependencyManifestHashes"),
      `${label}.dependencyManifestHashes`,
    ),
    bodyHash: readRecordString(record, "bodyHash", label),
    signerUserId: readRecordString(record, "signerUserId", label),
    signerDeviceId: readRecordString(record, "signerDeviceId", label),
    signerKeyFingerprint: readRecordString(
      record,
      "signerKeyFingerprint",
      label,
    ),
    signedAt: readRecordString(record, "signedAt", label),
    signature: readRecordString(record, "signature", label),
  };
}

function readAccessManifest(value: unknown, label: string): AccessManifest {
  const record = readCanonicalRecord(value, label);
  const objectKind = readRecordValue(record, "objectKind");
  if (!isAccessObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  const referencedPrincipalHeads = readRecordValue(
    record,
    "referencedPrincipalHeads",
  );
  if (!Array.isArray(referencedPrincipalHeads)) {
    throw new Error(`${label}.referencedPrincipalHeads must be an array`);
  }

  return {
    version: 1,
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordNumber(record, "epoch", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    eventHash: readRecordString(record, "eventHash", label),
    structuralHash: readRecordString(record, "structuralHash", label),
    grantRoot: readRecordString(record, "grantRoot", label),
    referencedPrincipalHeads: referencedPrincipalHeads.map((head, index) => {
      const headRecord = readCanonicalRecord(
        head,
        `${label}.referencedPrincipalHeads[${index}]`,
      );
      const principalType = readRecordValue(headRecord, "principalType");
      if (principalType !== "group" && principalType !== "organization") {
        throw new Error(
          `${label}.referencedPrincipalHeads[${index}].principalType is invalid`,
        );
      }
      return {
        principalType,
        principalId: readRecordString(
          headRecord,
          "principalId",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        version: readRecordNumber(
          headRecord,
          "version",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        keyEpoch: readRecordNumber(
          headRecord,
          "keyEpoch",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        stateHash: readRecordString(
          headRecord,
          "stateHash",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        keyFingerprint: readRecordString(
          headRecord,
          "keyFingerprint",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
      };
    }),
    keyTargetHash: readRecordString(record, "keyTargetHash", label),
  };
}

function readDocumentLinkSetManifestState(
  value: unknown,
  label: string,
): DocumentLinkSetManifestState {
  const record = readCanonicalRecord(value, label);
  if (readRecordInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }

  return {
    version: 1,
    documentId: readRecordString(record, "documentId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordNumber(record, "epoch", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    eventHash: readRecordString(record, "eventHash", label),
    linkedContainerIds: readStringArray(
      readRecordValue(record, "linkedContainerIds"),
      `${label}.linkedContainerIds`,
    ),
  };
}

function readWriteHeader(value: unknown, label: string): WriteHeader {
  const record = readCanonicalRecord(value, label);
  const objectKind = readRecordValue(record, "objectKind");
  if (!isContentObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  const encryptionSuite = readRecordValue(record, "encryptionSuite");
  if (encryptionSuite !== CONTENT_RECORD_ENCRYPTION_SUITE) {
    throw new Error(`${label}.encryptionSuite is invalid`);
  }

  return {
    version: 1,
    organizationId: readRecordString(record, "organizationId", label),
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    accessManifestHash: readRecordString(record, "accessManifestHash", label),
    contentKeyEpoch: readRecordNumber(record, "contentKeyEpoch", label),
    targetHash: readRecordString(record, "targetHash", label),
    encryptionSuite,
    contentRecordId: readRecordString(record, "contentRecordId", label),
    nonceDomainHash: readRecordString(record, "nonceDomainHash", label),
    metadataHash: readRecordString(record, "metadataHash", label),
    ciphertextHash: readRecordString(record, "ciphertextHash", label),
    writerUserId: readRecordString(record, "writerUserId", label),
    writerDeviceId: readRecordString(record, "writerDeviceId", label),
    writerKeyFingerprint: readRecordString(
      record,
      "writerKeyFingerprint",
      label,
    ),
    signedAt: readRecordString(record, "signedAt", label),
    signature: readRecordString(record, "signature", label),
  };
}

function readManifestContainerId(
  bundle: ContainerWriterProjectionResponse["path"][number],
): string | null {
  const containerId = isPlainRecord(bundle.state)
    ? Reflect.get(bundle.state, "containerId")
    : undefined;

  return isPlainRecord(bundle.state) && typeof containerId === "string"
    ? containerId
    : null;
}

function targetKey(target: DocumentContentKeyTarget): string {
  return [
    target.containerId,
    target.containerManifestHash,
    target.containerKeyEpochId,
    String(target.containerKeyEpoch),
  ].join(":");
}

function sortDocumentTargets<T extends DocumentContentKeyTarget>(
  targets: readonly T[],
): T[] {
  return [...targets].sort((left, right) =>
    targetKey(left).localeCompare(targetKey(right)),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeDocumentTargetKek(target: DocumentContentKeyTarget): string {
  return `container ${target.containerId} epoch ${target.containerKeyEpochId}`;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function readRecordNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}.${key} must be a positive integer`);
  }
  return value;
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

function asWebCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!(bytes.buffer instanceof ArrayBuffer)) {
    throw new Error("Document byte material must be ArrayBuffer-backed");
  }
  return bytes as Uint8Array<ArrayBuffer>;
}

function assertOnlyRecordKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  const unexpectedKeys = Object.keys(record).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `${label} has unexpected keys: ${unexpectedKeys.join(",")}`,
    );
  }
}

function normalizeContainerKeyWrap(value: unknown): ContainerKeyWrap {
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

export async function unwrapContainerKekPath(input: {
  execSql?: ExecSql | undefined;
  projection: ContainerWriterProjectionResponse;
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

async function wrapDocumentContentKeyForCreate(input: {
  contentKey: Uint8Array;
  execSql?: ExecSql | undefined;
  projection: ContainerWriterProjectionResponse;
  secretKey: Uint8Array;
}): Promise<DocumentContentKeyTargetEnvelope[]> {
  const target = getOnlyDocumentCreateTarget(input.projection);
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.projection,
    secretKey: input.secretKey,
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

function mergeTargetEnvelopes(
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

export async function buildDocumentCreatePlan({
  author,
  containerProjection,
  contentKeyEpoch = 1,
  documentId = crypto.randomUUID(),
  eventId = crypto.randomUUID(),
  signedAt = new Date().toISOString(),
  targetEnvelopes,
}: BuildDocumentCreatePlanInput): Promise<DocumentCreatePlan> {
  if (author.organizationId !== containerProjection.organizationId) {
    throw new Error("Document author organization does not match container");
  }

  const targets = deriveDocumentCreateTargets(containerProjection);
  const targetEnvelopesForRequest = mergeTargetEnvelopes(
    targets,
    targetEnvelopes,
  );
  const targetContainerManifestHash = targets[0]?.containerManifestHash;
  const targetContainerId = targets[0]?.containerId;
  if (!targetContainerManifestHash || !targetContainerId) {
    throw new Error("Document create target is unavailable");
  }

  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: targetContainerId,
    containerManifestHash: targetContainerManifestHash,
  };
  const bodyHash = await computeAccessEventBodyHash(
    readCanonicalJson(body, "Document create body"),
  );
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
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
  const state: DocumentLinkSetManifestState = {
    version: 1,
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
      event: readCanonicalRecord(event, "Document create event"),
      body: readCanonicalRecord(body, "Document create body"),
      expectedManifestHash: manifestHash,
      manifest: readCanonicalRecord(manifest, "Document create manifest"),
      previousManifest: null,
      targetContainerPath: readCanonicalRecords(
        containerProjection.path,
        "Document create target container path",
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

export async function buildMaterializedDocumentCreatePlan(input: {
  author: DocumentCreateAuthor;
  containerProjection: ContainerWriterProjectionResponse;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<MaterializedDocumentCreatePlan> {
  const contentKey =
    input.contentKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }
  const targetEnvelopes = await wrapDocumentContentKeyForCreate({
    contentKey,
    execSql: input.execSql,
    projection: input.containerProjection,
    secretKey: input.targetSecretKey,
  });
  const plan = await buildDocumentCreatePlan({
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

export async function createRemoteDocument(input: {
  apiClient: DocumentCreateApi;
  author: DocumentCreateAuthor;
  containerId: string;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<CreateRemoteDocumentResult | null> {
  const containerProjection =
    await input.apiClient.getContainerWriterProjection(input.containerId);
  if (!containerProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedDocumentCreatePlan({
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
  const response = await input.apiClient.createDocument(
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }
  const persistedState = persistedDocumentCreateStateFromResponse(
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

function projectionPathRecords(
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

function deriveDocumentTargetFromProjection(
  projection: ContainerWriterProjectionResponse,
): DocumentContentKeyTarget {
  const target = deriveDocumentCreateTargets(projection)[0];
  if (!target) {
    throw new Error("Document target projection is unavailable");
  }
  return target;
}

function readLinkedContainerIdsFromDocumentManifest(
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

function currentDocumentTargets(
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
): Promise<DocumentContentKeyTarget[]> {
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

function deriveDocumentLinkSetTargetState(input: {
  operation: DocumentLinkSetMutationOperation;
  targetContainerProjection: ContainerWriterProjectionResponse;
  writerProjection: DocumentWriterProjectionResponse;
}): DocumentLinkSetTargetState {
  const currentTargets = currentDocumentTargets(input.writerProjection);
  const currentLinkedContainerIds = readLinkedContainerIdsFromDocumentManifest(
    input.writerProjection,
  );
  const target = deriveDocumentTargetFromProjection(
    input.targetContainerProjection,
  );
  const currentTarget = currentTargets.find(
    (candidate) => candidate.containerId === target.containerId,
  );

  if (input.operation === "link") {
    if (currentTarget) {
      throw new Error("Document link target is already linked");
    }

    return {
      currentTargets,
      linkedContainerIds: uniqueSortedStrings([
        ...currentLinkedContainerIds,
        target.containerId,
      ]),
      target,
      targets: sortDocumentTargets([...currentTargets, target]),
    };
  }

  if (!currentTarget) {
    throw new Error("Document unlink target is not linked");
  }
  if (targetKey(currentTarget) !== targetKey(target)) {
    throw new Error("Document unlink target projection is stale");
  }

  const linkedContainerIds = currentLinkedContainerIds.filter(
    (containerId) => containerId !== target.containerId,
  );
  if (linkedContainerIds.length === 0) {
    throw new Error("Document unlink must leave a linked container");
  }

  return {
    currentTargets,
    linkedContainerIds,
    target,
    targets: currentTargets.filter(
      (candidate) => candidate.containerId !== target.containerId,
    ),
  };
}

function authorizingContainerPathRecordsForLinkSet(input: {
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

async function wrapDocumentContentKeyForTargets(input: {
  contentKey: Uint8Array;
  keksByEpochId: ReadonlyMap<string, Uint8Array>;
  targets: readonly DocumentContentKeyTarget[];
}): Promise<DocumentContentKeyTargetEnvelope[]> {
  return Promise.all(
    sortDocumentTargets(input.targets).map(async (target) => {
      const targetKek = input.keksByEpochId.get(target.containerKeyEpochId);
      if (!targetKek) {
        throw new Error(
          `Document target KEK could not be unwrapped for ${describeDocumentTargetKek(target)}`,
        );
      }

      const wrapped = await encryptWithDek(input.contentKey, targetKek);
      return {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      };
    }),
  );
}

async function assertDocumentLinkSetMutationOrganizations(input: {
  author: DocumentCreateAuthor;
  targetContainerProjection: ContainerWriterProjectionResponse;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<void> {
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.writerProjection.documentManifest,
    label: "Document link-set manifest",
  });
  if (input.author.organizationId !== manifestIdentity.organizationId) {
    throw new Error("Document link-set author organization mismatch");
  }
  if (
    input.author.organizationId !==
    input.targetContainerProjection.organizationId
  ) {
    throw new Error("Document target container organization mismatch");
  }
}

function readDocumentLinkSetPreviousEpoch(
  writerProjection: DocumentWriterProjectionResponse,
): number {
  const previousState = writerProjection.documentManifest.state;
  const previousEpoch = isPlainRecord(previousState)
    ? Reflect.get(previousState, "epoch")
    : undefined;
  if (
    typeof previousEpoch !== "number" ||
    !Number.isInteger(previousEpoch) ||
    previousEpoch <= 0
  ) {
    throw new Error("Document link-set previous epoch is invalid");
  }

  return previousEpoch;
}

async function buildDocumentLinkSetEventPlan(input: {
  author: DocumentCreateAuthor;
  eventId: string;
  operation: DocumentLinkSetMutationOperation;
  signedAt: string;
  targetState: DocumentLinkSetTargetState;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<DocumentLinkSetEventPlan> {
  const eventType =
    input.operation === "link" ? "document.link" : "document.unlink";
  const body: DocumentLinkSetMutationBody = {
    eventType,
    containerId: input.targetState.target.containerId,
    containerManifestHash: input.targetState.target.containerManifestHash,
  };
  const bodyHash = await computeAccessEventBodyHash(
    readCanonicalJson(body, "Document link-set body"),
  );
  const authorizingContainerPaths = authorizingContainerPathRecordsForLinkSet({
    operation: input.operation,
    targetContainerId: input.targetState.target.containerId,
    writerProjection: input.writerProjection,
  });
  const dependencyManifestHashes = uniqueSortedStrings([
    input.targetState.target.containerManifestHash,
    ...authorizingContainerPaths
      .map((path) => Reflect.get(path.at(-1) ?? {}, "manifestHash"))
      .filter((hash): hash is string => typeof hash === "string"),
  ]);
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId: input.eventId,
    eventType,
    objectKind: "document",
    objectId: input.writerProjection.documentId,
    organizationId: input.author.organizationId,
    previousManifestHash: input.writerProjection.documentManifest.manifestHash,
    dependencyManifestHashes,
    bodyHash,
    signerUserId: input.author.signerUserId,
    signerDeviceId: input.author.signerDeviceId,
    signerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.signedAt,
  };
  const event = await signAccessEvent(
    unsignedEvent,
    input.author.signerPrivateKey,
  );
  const eventHash = await computeAccessEventHash(event);

  return {
    authorizingContainerPaths,
    body,
    event,
    eventHash,
  };
}

async function buildDocumentLinkSetMutationPlan({
  author,
  contentKeyEpoch,
  eventId = crypto.randomUUID(),
  operation,
  signedAt = new Date().toISOString(),
  targetContainerProjection,
  targetEnvelopes,
  writerProjection,
}: BuildDocumentLinkSetMutationPlanInput): Promise<DocumentLinkSetMutationPlan> {
  await assertDocumentLinkSetMutationOrganizations({
    author,
    targetContainerProjection,
    writerProjection,
  });
  const targetState = deriveDocumentLinkSetTargetState({
    operation,
    targetContainerProjection,
    writerProjection,
  });
  const targetEnvelopesForRequest = mergeTargetEnvelopes(
    targetState.targets,
    targetEnvelopes,
  );
  const eventPlan = await buildDocumentLinkSetEventPlan({
    author,
    eventId,
    operation,
    signedAt,
    targetState,
    writerProjection,
  });
  const previousEpoch = readDocumentLinkSetPreviousEpoch(writerProjection);

  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: writerProjection.documentId,
    organizationId: author.organizationId,
    epoch: previousEpoch + 1,
    previousManifestHash: writerProjection.documentManifest.manifestHash,
    eventHash: eventPlan.eventHash,
    linkedContainerIds: [...targetState.linkedContainerIds],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash(
    targetState.targets,
  );

  return {
    body: eventPlan.body,
    contentKeyEpoch,
    documentId: writerProjection.documentId,
    event: eventPlan.event,
    eventHash: eventPlan.eventHash,
    manifest,
    manifestHash,
    operation,
    request: {
      event: readCanonicalRecord(eventPlan.event, "Document link-set event"),
      body: readCanonicalRecord(eventPlan.body, "Document link-set body"),
      expectedManifestHash: manifestHash,
      manifest: readCanonicalRecord(manifest, "Document link-set manifest"),
      previousManifest: writerProjection.documentManifest,
      targetContainerPath: projectionPathRecords(targetContainerProjection),
      authorizingContainerPaths: eventPlan.authorizingContainerPaths,
      contentKeyBundle: {
        contentKeyEpoch,
        linkSetManifestHash: manifestHash,
        targetHash,
        targets: targetEnvelopesForRequest,
      },
    },
    state,
    targetHash,
    targets: sortDocumentTargets(targetState.targets),
  };
}

export async function buildMaterializedDocumentLinkSetMutationPlan(input: {
  author: DocumentCreateAuthor;
  contentKey?: Uint8Array | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  operation: DocumentLinkSetMutationOperation;
  signedAt?: string | undefined;
  targetContainerProjection: ContainerWriterProjectionResponse;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<MaterializedDocumentLinkSetMutationPlan> {
  await assertDocumentWriterProjectionConsistent(input.writerProjection);
  const targetState = deriveDocumentLinkSetTargetState({
    operation: input.operation,
    targetContainerProjection: input.targetContainerProjection,
    writerProjection: input.writerProjection,
  });
  const currentContentKey = await unwrapDocumentContentKeyFromWriterProjection({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
  });
  const contentKeyRotated = input.operation === "unlink";
  const contentKey = contentKeyRotated
    ? (input.contentKey ?? crypto.getRandomValues(new Uint8Array(32)))
    : currentContentKey;
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }

  const targetEnvelopes =
    input.operation === "link"
      ? [
          ...input.writerProjection.contentKeyBundle.targets,
          ...(await wrapDocumentContentKeyForTargets({
            contentKey,
            keksByEpochId: await unwrapContainerKekPath({
              execSql: input.execSql,
              projection: input.targetContainerProjection,
              secretKey: input.targetSecretKey,
            }),
            targets: [targetState.target],
          })),
        ]
      : await wrapDocumentContentKeyForTargets({
          contentKey,
          keksByEpochId: await collectContainerKeksForDocumentSync({
            execSql: input.execSql,
            secretKey: input.targetSecretKey,
            writerProjection: input.writerProjection,
          }),
          targets: targetState.targets,
        });

  const plan = await buildDocumentLinkSetMutationPlan({
    author: input.author,
    contentKeyEpoch:
      input.writerProjection.contentKeyBundle.contentKeyEpoch +
      (contentKeyRotated ? 1 : 0),
    eventId: input.eventId,
    operation: input.operation,
    signedAt: input.signedAt,
    targetContainerProjection: input.targetContainerProjection,
    targetEnvelopes,
    writerProjection: input.writerProjection,
  });

  return {
    contentKey,
    contentKeyRotated,
    plan,
  };
}

function assertLinkSetMutationResponseMatchesPlan(
  plan: DocumentLinkSetMutationPlan,
  response: DocumentLinkSetMutationResponse,
): void {
  if (response.id !== plan.documentId) {
    throw new Error("Document link-set response id mismatch");
  }
  if (response.accessManifest.manifestHash !== plan.manifestHash) {
    throw new Error("Document link-set response manifest hash mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.manifest, "manifest") !==
    serializeCanonical(plan.manifest, "manifest")
  ) {
    throw new Error("Document link-set response manifest mismatch");
  }

  const responseEvent = response.accessManifest.event;
  if (!isPlainRecord(responseEvent)) {
    throw new Error("Document link-set response event bundle is invalid");
  }
  if (
    readRecordString(responseEvent, "eventHash", "event bundle") !==
    plan.eventHash
  ) {
    throw new Error("Document link-set response event hash mismatch");
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "event"), "event") !==
    serializeCanonical(plan.event, "event")
  ) {
    throw new Error("Document link-set response event mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.state, "state") !==
    serializeCanonical(plan.state, "state")
  ) {
    throw new Error("Document link-set response state mismatch");
  }
  if (
    response.contentKeyBundle.documentId !== plan.documentId ||
    response.contentKeyBundle.contentKeyEpoch !== plan.contentKeyEpoch ||
    response.contentKeyBundle.linkSetManifestHash !== plan.manifestHash ||
    response.contentKeyBundle.targetHash !== plan.targetHash
  ) {
    throw new Error("Document link-set response content-key mismatch");
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
    throw new Error("Document link-set response content-key targets mismatch");
  }
  if (
    response.documentKekTargets.documentId !== plan.documentId ||
    response.documentKekTargets.linkSetManifestHash !== plan.manifestHash ||
    response.documentKekTargets.documentKeyTargetHash !== plan.targetHash
  ) {
    throw new Error("Document link-set response KEK target mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets.targets, "KEK targets") !==
    serializeCanonical(plan.targets, "KEK targets")
  ) {
    throw new Error("Document link-set response KEK targets mismatch");
  }
}

export function persistedDocumentLinkSetMutationStateFromResponse(
  plan: DocumentLinkSetMutationPlan,
  response: DocumentLinkSetMutationResponse,
): PersistedDocumentCreateState {
  assertLinkSetMutationResponseMatchesPlan(plan, response);

  return {
    documentId: response.id,
    contentKeyBundle: serializeState(response.contentKeyBundle),
    documentKekTargets: serializeState(response.documentKekTargets),
    documentManifestBundle: serializeState(response.accessManifest),
  };
}

export async function relinkRemoteDocument(input: {
  apiClient: DocumentLinkSetMutationApi;
  author: DocumentCreateAuthor;
  contentKey?: Uint8Array | undefined;
  documentId: string;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  operation: DocumentLinkSetMutationOperation;
  signedAt?: string | undefined;
  targetContainerId: string;
  targetSecretKey: Uint8Array;
}): Promise<RelinkRemoteDocumentResult | null> {
  const [writerProjection, targetContainerProjection] = await Promise.all([
    input.apiClient.getDocumentWriterProjection(input.documentId),
    input.apiClient.getContainerWriterProjection(input.targetContainerId),
  ]);
  if (!writerProjection || !targetContainerProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedDocumentLinkSetMutationPlan({
    author: input.author,
    contentKey: input.contentKey,
    eventId: input.eventId,
    execSql: input.execSql,
    operation: input.operation,
    signedAt: input.signedAt,
    targetContainerProjection,
    targetSecretKey: input.targetSecretKey,
    writerProjection,
  });
  const response =
    input.operation === "link"
      ? await input.apiClient.linkDocument(
          materializedPlan.plan.documentId,
          materializedPlan.plan.request,
        )
      : await input.apiClient.unlinkDocument(
          materializedPlan.plan.documentId,
          materializedPlan.plan.request,
        );
  if (!response) {
    return null;
  }
  const persistedState = persistedDocumentLinkSetMutationStateFromResponse(
    materializedPlan.plan,
    response,
  );

  return {
    contentKey: materializedPlan.contentKey,
    contentKeyRotated: materializedPlan.contentKeyRotated,
    documentId: response.id,
    linkedContainerIds: [...materializedPlan.plan.state.linkedContainerIds],
    persistedState,
    plan: materializedPlan.plan,
    response,
  };
}

function contentRecordDerivationPayload(input: {
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  organizationId: string;
}): Record<string, KeyingCanonicalJson> {
  return {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.contentRecordId,
  };
}

function contentRecordDerivationBytes(input: {
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: DOCUMENT_CONTENT_RECORD_KEY_INFO_DOMAIN,
      payload: contentRecordDerivationPayload(input),
    }),
  );
}

function contentRecordAdditionalDataBytes(input: {
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  metadataHash: string;
  nonceDomainHash: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
      payload: {
        ...contentRecordDerivationPayload(input),
        metadataHash: input.metadataHash,
        nonceDomainHash: input.nonceDomainHash,
      },
    }),
  );
}

async function deriveDocumentContentRecordKey(input: {
  contentKeyMaterial: CryptoKey;
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  organizationId: string;
  usage: "decrypt" | "encrypt";
}): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: DOCUMENT_CONTENT_RECORD_HKDF_SALT,
      info: contentRecordDerivationBytes(input),
    },
    input.contentKeyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    [input.usage],
  );
}

async function importDocumentContentKeyMaterial(
  contentKey: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asWebCryptoBytes(contentKey),
    "HKDF",
    false,
    ["deriveKey"],
  );
}

async function encryptDocumentPendingUpdate(input: {
  contentKeyMaterial: CryptoKey;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: PendingUpdateRecord;
}): Promise<DocumentEncryptedPendingUpdate> {
  const contentRecordId = input.update.id;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  });
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: input.documentId,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
    updateId: input.update.id,
  });
  const recordKey = await deriveDocumentContentRecordKey({
    contentKeyMaterial: input.contentKeyMaterial,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId,
    documentId: input.documentId,
    organizationId: input.organizationId,
    usage: "encrypt",
  });
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: DOCUMENT_CONTENT_RECORD_IV,
        additionalData: contentRecordAdditionalDataBytes({
          contentKeyEpoch: input.contentKeyEpoch,
          contentRecordId,
          documentId: input.documentId,
          metadataHash,
          nonceDomainHash,
          organizationId: input.organizationId,
        }),
      },
      recordKey,
      asWebCryptoBytes(base64ToBytes(input.update.updateData)),
    ),
  );
  const encryptedData = serializeKeyingCanonicalJson({
    format: DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
    version: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId,
    nonceDomainHash,
    metadataHash,
    iv: bytesToBase64(DOCUMENT_CONTENT_RECORD_IV),
    ciphertext: bytesToBase64(ciphertext),
  });

  return {
    contentRecordId,
    encryptedData,
    metadataHash,
    ciphertextHash:
      await computeDocumentContentRecordCiphertextHash(encryptedData),
  };
}

function parseDocumentEncryptedUpdate(
  encryptedData: string,
): ParsedDocumentEncryptedUpdate {
  let value: unknown;
  try {
    value = JSON.parse(encryptedData);
  } catch {
    throw new Error("Document encrypted update is invalid JSON");
  }
  if (!isPlainRecord(value)) {
    throw new Error("Document encrypted update must be an object");
  }
  assertOnlyRecordKeys(
    value,
    DOCUMENT_ENCRYPTED_UPDATE_KEYS,
    "Document encrypted update",
  );
  if (
    readRecordString(value, "format", "Document encrypted update") !==
    DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT
  ) {
    throw new Error("Document encrypted update format is invalid");
  }
  const version = readRecordNumber(
    value,
    "version",
    "Document encrypted update",
  );
  if (version !== 1) {
    throw new Error(
      `Document encrypted update version ${version} is invalid; expected 1`,
    );
  }
  if (
    readRecordString(value, "encryptionSuite", "Document encrypted update") !==
    CONTENT_RECORD_ENCRYPTION_SUITE
  ) {
    throw new Error("Document encrypted update suite is invalid");
  }

  const iv = base64ToBytes(
    readRecordString(value, "iv", "Document encrypted update"),
  );
  assertEqualBytes(
    iv,
    DOCUMENT_CONTENT_RECORD_IV,
    "Document encrypted update IV is invalid",
  );

  return {
    ciphertext: base64ToBytes(
      readRecordString(value, "ciphertext", "Document encrypted update"),
    ),
    contentKeyEpoch: readRecordNumber(
      value,
      "contentKeyEpoch",
      "Document encrypted update",
    ),
    contentRecordId: readRecordString(
      value,
      "contentRecordId",
      "Document encrypted update",
    ),
    metadataHash: readRecordString(
      value,
      "metadataHash",
      "Document encrypted update",
    ),
    nonceDomainHash: readRecordString(
      value,
      "nonceDomainHash",
      "Document encrypted update",
    ),
    iv,
  };
}

async function assertDocumentEncryptedUpdateMatchesHeader(input: {
  encrypted: ParsedDocumentEncryptedUpdate;
  encryptedData: string;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: DocumentSyncResponse["updates"][number];
}): Promise<void> {
  const { encrypted, update } = input;
  if (encrypted.contentKeyEpoch !== input.contentKeyEpoch) {
    throw new Error("Document encrypted update content-key epoch mismatch");
  }
  if (update.documentId !== input.documentId) {
    throw new Error("Document encrypted update document id mismatch");
  }
  const headerContentRecordId = readRecordString(
    update.writeHeader,
    "contentRecordId",
    "write header",
  );
  if (encrypted.contentRecordId !== headerContentRecordId) {
    throw new Error("Document encrypted update content record mismatch");
  }

  // Keep this helper fail-closed even when it is used outside syncRemoteDocument.
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: input.documentId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    updateId: update.id,
  });
  if (
    encrypted.metadataHash !== metadataHash ||
    encrypted.metadataHash !==
      readRecordString(update.writeHeader, "metadataHash", "write header")
  ) {
    throw new Error("Document encrypted update metadata hash mismatch");
  }

  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: encrypted.contentRecordId,
  });
  if (
    encrypted.nonceDomainHash !== nonceDomainHash ||
    encrypted.nonceDomainHash !==
      readRecordString(update.writeHeader, "nonceDomainHash", "write header")
  ) {
    throw new Error("Document encrypted update nonce domain mismatch");
  }

  const ciphertextHash = await computeDocumentContentRecordCiphertextHash(
    input.encryptedData,
  );
  if (
    ciphertextHash !==
    readRecordString(update.writeHeader, "ciphertextHash", "write header")
  ) {
    throw new Error("Document encrypted update ciphertext hash mismatch");
  }
}

async function decryptDocumentSyncUpdate(input: {
  contentKeyMaterial: CryptoKey;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: DocumentSyncResponse["updates"][number];
}): Promise<DecryptedDocumentSyncUpdate> {
  const encrypted = parseDocumentEncryptedUpdate(input.update.encryptedData);
  await assertDocumentEncryptedUpdateMatchesHeader({
    encrypted,
    encryptedData: input.update.encryptedData,
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    organizationId: input.organizationId,
    update: input.update,
  });
  const recordKey = await deriveDocumentContentRecordKey({
    contentKeyMaterial: input.contentKeyMaterial,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId: encrypted.contentRecordId,
    documentId: input.documentId,
    organizationId: input.organizationId,
    usage: "decrypt",
  });
  const updateData = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asWebCryptoBytes(encrypted.iv),
        additionalData: contentRecordAdditionalDataBytes({
          contentKeyEpoch: input.contentKeyEpoch,
          contentRecordId: encrypted.contentRecordId,
          documentId: input.documentId,
          metadataHash: encrypted.metadataHash,
          nonceDomainHash: encrypted.nonceDomainHash,
          organizationId: input.organizationId,
        }),
      },
      recordKey,
      asWebCryptoBytes(encrypted.ciphertext),
    ),
  );

  return {
    id: input.update.id,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
    updateData,
  };
}

export async function decryptDocumentSyncUpdates(input: {
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  updates: readonly DocumentSyncResponse["updates"][number][];
}): Promise<DecryptedDocumentSyncUpdate[]> {
  if (input.updates.length === 0) {
    return [];
  }
  const contentKeyMaterial = await importDocumentContentKeyMaterial(
    input.contentKey,
  );

  return Promise.all(
    input.updates.map((update) =>
      decryptDocumentSyncUpdate({
        contentKeyMaterial,
        contentKeyEpoch: input.contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
      }),
    ),
  );
}

function assertEqualBytes(
  left: Uint8Array,
  right: Uint8Array,
  message: string,
): void {
  if (
    left.byteLength !== right.byteLength ||
    left.some((byte, index) => byte !== right[index])
  ) {
    throw new Error(message);
  }
}

async function collectContainerKeksForDocumentSync(input: {
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

async function unwrapDocumentContentKeyFromWriterProjection(input: {
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
    throw new Error("Document content key could not be unwrapped");
  }
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }

  return contentKey;
}

function authorizingContainerPathRecords(
  writerProjection: DocumentWriterProjectionResponse,
): Record<string, unknown>[][] {
  return readCanonicalRecordPaths(
    writerProjection.authorizingContainerPaths.map(
      (projection) => projection.path,
    ),
    "Document authorizing container paths",
  );
}

async function prepareDocumentOutgoingUpdates(input: {
  contentKey: Uint8Array;
  documentId: string;
  organizationId: string;
  pendingUpdates: readonly PendingUpdateRecord[];
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<DocumentSyncPreparedUpdate[]> {
  if (input.pendingUpdates.length === 0) {
    return [];
  }
  const contentKeyMaterial = await importDocumentContentKeyMaterial(
    input.contentKey,
  );

  return Promise.all(
    input.pendingUpdates.map(async (update) => {
      const encrypted = await encryptDocumentPendingUpdate({
        contentKeyMaterial,
        contentKeyEpoch:
          input.writerProjection.contentKeyBundle.contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
      });

      return {
        contentRecordId: encrypted.contentRecordId,
        encryptedData: encrypted.encryptedData,
        id: update.id,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        metadataHash: encrypted.metadataHash,
        ciphertextHash: encrypted.ciphertextHash,
        ...(update.sourceVersionVector
          ? {
              checkpointKind: "rotate_baseline" as const,
              sourceVersionVector: update.sourceVersionVector,
            }
          : {}),
      };
    }),
  );
}

export async function buildMaterializedDocumentSyncPlan(input: {
  author: DocumentCreateAuthor;
  execSql?: ExecSql | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<MaterializedDocumentSyncPlan> {
  await assertDocumentWriterProjectionConsistent(input.writerProjection);
  const contentKey = await unwrapDocumentContentKeyFromWriterProjection({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
  });
  const documentId = input.writerProjection.documentId;
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.writerProjection.documentManifest,
    label: "Document sync manifest",
  });
  const outgoingUpdates = await prepareDocumentOutgoingUpdates({
    contentKey,
    documentId,
    organizationId: manifestIdentity.organizationId,
    pendingUpdates: input.pendingUpdates ?? [],
    writerProjection: input.writerProjection,
  });
  const plan = await buildDocumentSyncPlan({
    author: {
      ...input.author,
      organizationId: manifestIdentity.organizationId,
    },
    authorizingContainerPaths: authorizingContainerPathRecords(
      input.writerProjection,
    ),
    contentKeyBundle: input.writerProjection.contentKeyBundle,
    documentId,
    documentKekTargets: input.writerProjection.documentKekTargets,
    documentManifest: input.writerProjection.documentManifest,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    outgoingUpdates,
    signedAt: input.signedAt,
  });

  return {
    contentKey,
    plan,
  };
}

function contentKeyBundleForSyncRequest(
  bundle: DocumentCreateResponse["contentKeyBundle"],
): NonNullable<DocumentSyncRequest["contentKeyBundle"]> {
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
  bundle: DocumentCreateResponse["accessManifest"],
): NonNullable<DocumentSyncRequest["documentManifest"]> {
  return {
    event: bundle.event,
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
    state: bundle.state,
  };
}

function readDocumentTarget(
  value: Record<string, unknown>,
  label: string,
): DocumentContentKeyTarget {
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

function normalizeDocumentKekTargetResponse(
  targets: DocumentSyncResponse["documentKekTargets"],
): DocumentContentKeyTarget[] {
  return sortDocumentTargets(
    targets.targets.map((target, index) => {
      if (!isPlainRecord(target)) {
        throw new Error(`Document KEK target[${index}] is invalid`);
      }
      return readDocumentTarget(target, `Document KEK target[${index}]`);
    }),
  );
}

function targetEnvelopeReference(
  envelope: DocumentCreateResponse["contentKeyBundle"]["targets"][number],
): DocumentContentKeyTarget {
  return {
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

async function assertDocumentManifestBundleConsistent(input: {
  bundle: DocumentCreateResponse["accessManifest"];
  label: string;
}): Promise<{ documentId: string; organizationId: string }> {
  const manifestHash = await computeAccessManifestHash(
    readAccessManifest(input.bundle.manifest, `${input.label} manifest`),
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
  const accessEvent = readAccessEvent(event, `${input.label} signed event`);
  const computedEventHash = await computeAccessEventHash(accessEvent);
  if (computedEventHash !== eventHash) {
    throw new Error(`${input.label} event hash mismatch`);
  }

  const state = readDocumentLinkSetManifestState(
    input.bundle.state,
    `${input.label} state`,
  );
  if (state.eventHash !== eventHash) {
    throw new Error(`${input.label} state event hash mismatch`);
  }
  const derivedManifest = await deriveDocumentLinkSetManifest(state);
  if (
    serializeCanonical(input.bundle.manifest, "manifest") !==
    serializeCanonical(derivedManifest, "manifest")
  ) {
    throw new Error(`${input.label} manifest state mismatch`);
  }

  return {
    documentId: state.documentId,
    organizationId: state.organizationId,
  };
}

async function resolveDocumentSyncIdentity(
  input: BuildDocumentSyncPlanInput,
): Promise<{
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
}> {
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.documentManifest,
    label: "Document sync manifest",
  });
  const documentId = input.documentId ?? input.contentKeyBundle.documentId;
  if (documentId.length === 0) {
    throw new Error("Document sync document id is empty");
  }
  if (
    input.contentKeyBundle.documentId !== documentId ||
    input.documentKekTargets.documentId !== documentId ||
    manifestIdentity.documentId !== documentId
  ) {
    throw new Error("Document sync state document id mismatch");
  }
  if (manifestIdentity.organizationId !== input.author.organizationId) {
    throw new Error("Document sync author organization mismatch");
  }
  if (
    input.documentManifest.manifestHash !==
      input.contentKeyBundle.linkSetManifestHash ||
    input.documentKekTargets.linkSetManifestHash !==
      input.contentKeyBundle.linkSetManifestHash
  ) {
    throw new Error("Document sync link manifest mismatch");
  }
  if (
    input.documentKekTargets.documentKeyTargetHash !==
    input.contentKeyBundle.targetHash
  ) {
    throw new Error("Document sync target hash mismatch");
  }

  const kekTargets = normalizeDocumentKekTargetResponse(
    input.documentKekTargets,
  );
  const contentKeyTargets = sortDocumentTargets(
    input.contentKeyBundle.targets.map(targetEnvelopeReference),
  );
  if (
    serializeCanonical(kekTargets, "KEK targets") !==
    serializeCanonical(contentKeyTargets, "content-key targets")
  ) {
    throw new Error("Document sync content-key targets mismatch");
  }

  const targetHash = await computeDocumentContentKeyTargetHash(kekTargets);
  if (targetHash !== input.contentKeyBundle.targetHash) {
    throw new Error("Document sync target hash is not canonical");
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
    throw new Error("Document sync write authorization paths are missing");
  }

  return paths.map((path, pathIndex) => {
    if (path.length === 0) {
      throw new Error(
        `Document sync write authorization path[${pathIndex}] is empty`,
      );
    }
    return path.map((bundle, bundleIndex) => {
      if (!isPlainRecord(bundle)) {
        throw new Error(
          `Document sync write authorization path[${pathIndex}][${bundleIndex}] is invalid`,
        );
      }
      return bundle;
    });
  });
}

async function signDocumentOutgoingUpdate(input: {
  author: DocumentCreateAuthor;
  contentKeyEpoch: number;
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
  signedAt: string;
  update: DocumentSyncPreparedUpdate;
}): Promise<DocumentOutgoingUpdate> {
  const contentRecordId = input.update.contentRecordId ?? input.update.id;
  const nonceDomain = {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  } as const;
  const unsignedHeader: UnsignedWriteHeader = {
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
    writeHeader: readCanonicalRecord(
      writeHeader,
      "Document outgoing write header",
    ),
  };
}

function assertUniqueDocumentOutgoingUpdates(
  updates: readonly DocumentSyncPreparedUpdate[],
): void {
  const updateIds = new Set<string>();
  const contentRecordIds = new Set<string>();
  for (const update of updates) {
    if (updateIds.has(update.id)) {
      throw new Error("Document sync update id is duplicated");
    }
    updateIds.add(update.id);

    const contentRecordId = (update.contentRecordId ?? update.id).toLowerCase();
    if (contentRecordIds.has(contentRecordId)) {
      throw new Error("Document sync content record id is duplicated");
    }
    contentRecordIds.add(contentRecordId);
  }
}

export async function buildDocumentSyncPlan(
  input: BuildDocumentSyncPlanInput,
): Promise<DocumentSyncPlan> {
  const {
    documentId,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    organizationId,
  } = await resolveDocumentSyncIdentity(input);
  const outgoingUpdateInputs = [...(input.outgoingUpdates ?? [])];
  const signedAt = input.signedAt ?? new Date().toISOString();
  assertUniqueDocumentOutgoingUpdates(outgoingUpdateInputs);

  const outgoingUpdates = await Promise.all(
    outgoingUpdateInputs.map((update) =>
      signDocumentOutgoingUpdate({
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
  // Writes always carry the verified current content-key bundle so the server
  // can validate and materialize the current wrapping material in the same
  // request. Read-only syncs omit it because they do not update server state.
  const shouldIncludeContentKeyBundle = outgoingUpdates.length > 0;
  const request: DocumentSyncRequest = {
    ...(shouldIncludeContentKeyBundle
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
    minLsn: input.minLsn,
    organizationId,
    request,
    sourceContentKeyBundle: input.contentKeyBundle,
  };
}

function assertAcceptedOutgoingUpdateIdsMatchPlan(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  const expected = plan.request.outgoingUpdates.map((update) => update.id);
  const accepted = response.acceptedOutgoingUpdateIds;
  const expectedSorted = [...expected].sort();
  const acceptedSorted = [...accepted].sort();
  if (
    expectedSorted.length !== acceptedSorted.length ||
    expectedSorted.some((id, index) => id !== acceptedSorted[index])
  ) {
    throw new Error("Document sync response accepted update mismatch");
  }
}

async function assertDocumentSyncResponseUpdateMatchesPlan(input: {
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<void> {
  const { plan, update } = input;
  if (update.documentId !== plan.documentId) {
    throw new Error("Document sync response update document mismatch");
  }
  const header = readWriteHeader(
    update.writeHeader,
    "Document sync response write header",
  );
  await assertDocumentSyncResponseUpdateHashes({ header, update });
  assertDocumentSyncResponseWriteHeaderFields({ header, plan, update });
  await assertDocumentSyncResponseNonceDomain({ plan, update });
  await assertDocumentSyncResponseWriteHeaderSignature({
    header,
    plan,
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    update,
    writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
  });
}

async function assertDocumentSyncResponseUpdateHashes(input: {
  header: WriteHeader;
  update: DocumentSyncResponse["updates"][number];
}): Promise<void> {
  const { header, update } = input;
  const headerHash = await computeWriteHeaderHash(header);
  if (headerHash !== update.writeHeaderHash) {
    throw new Error("Document sync response write header hash mismatch");
  }
  const ciphertextHash = await computeDocumentContentRecordCiphertextHash(
    update.encryptedData,
  );
  if (
    ciphertextHash !==
    readRecordString(update.writeHeader, "ciphertextHash", "write header")
  ) {
    throw new Error("Document sync response ciphertext hash mismatch");
  }
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: update.documentId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    updateId: update.id,
  });
  if (
    metadataHash !==
    readRecordString(update.writeHeader, "metadataHash", "write header")
  ) {
    throw new Error("Document sync response metadata hash mismatch");
  }
}

function assertDocumentSyncResponseWriteHeaderFields(input: {
  header: WriteHeader;
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
}): void {
  const { header, plan, update } = input;
  const mustMatchCurrentBoundary = input.plan.request.outgoingUpdates.some(
    (outgoingUpdate) => outgoingUpdate.id === input.update.id,
  );

  if (
    header.version !== 1 ||
    header.objectKind !== "document" ||
    header.objectId !== plan.documentId ||
    header.organizationId !== plan.organizationId ||
    header.contentKeyEpoch !== plan.contentKeyEpoch ||
    header.encryptionSuite !== CONTENT_RECORD_ENCRYPTION_SUITE ||
    header.writerKeyFingerprint !== update.authorFingerprint ||
    (mustMatchCurrentBoundary &&
      (header.accessManifestHash !== plan.expectedLinkSetManifestHash ||
        header.targetHash !== plan.expectedTargetHash))
  ) {
    throw new Error("Document sync response write header mismatch");
  }
}

function responseWriteHeaderSignatureBoundary(input: {
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
}):
  | {
      expectedAccessManifestHash: string;
      expectedTargetHash: string;
    }
  | Record<string, never> {
  const isAcceptedOutgoingUpdate = input.plan.request.outgoingUpdates.some(
    (outgoingUpdate) => outgoingUpdate.id === input.update.id,
  );

  if (!isAcceptedOutgoingUpdate) {
    return {};
  }

  return {
    expectedAccessManifestHash: input.plan.expectedLinkSetManifestHash,
    expectedTargetHash: input.plan.expectedTargetHash,
  };
}

async function assertDocumentSyncResponseNonceDomain(input: {
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
}): Promise<void> {
  const { plan, update } = input;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: plan.organizationId,
    objectKind: "document",
    objectId: plan.documentId,
    contentKeyEpoch: plan.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
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
    throw new Error("Document sync response nonce domain mismatch");
  }
}

async function assertDocumentSyncResponseWriteHeaderSignature(input: {
  header: WriteHeader;
  plan: DocumentSyncPlan;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  update: DocumentSyncResponse["updates"][number];
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<void> {
  const { header, plan, update } = input;
  if (!input.writerPublicKeysByFingerprint && !input.resolveWriterPublicKey) {
    throw new Error(
      "Document sync response writer public key verification is required",
    );
  }

  const writerPublicKey =
    input.writerPublicKeysByFingerprint?.get(update.authorFingerprint) ??
    (input.resolveWriterPublicKey
      ? await input.resolveWriterPublicKey({
          authorFingerprint: update.authorFingerprint,
          header,
          update,
        })
      : null);
  if (!writerPublicKey) {
    throw new Error("Document sync response writer public key missing");
  }

  const verified = await verifyWriteHeader({
    ...responseWriteHeaderSignatureBoundary({ plan, update }),
    expectedObject: {
      objectKind: "document",
      objectId: plan.documentId,
      organizationId: plan.organizationId,
    },
    header,
    writerPublicKey,
  });
  if (!verified.ok || verified.value.headerHash !== update.writeHeaderHash) {
    throw new Error("Document sync response write header signature mismatch");
  }
}

function assertDocumentSyncCommitCheckpointMatchesPlan(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  if (response.commitLsn !== null) {
    parseWalLsn(response.commitLsn, "Document sync response commit LSN");
  }
  if (plan.minLsn === undefined) {
    return;
  }
  const minLsn = parseWalLsn(
    plan.minLsn,
    "Document sync requested minimum LSN",
  );
  if (response.commitLsn === null) {
    throw new Error("Document sync response commit LSN is missing");
  }
  if (
    parseWalLsn(response.commitLsn, "Document sync response commit LSN") <
    minLsn
  ) {
    throw new Error("Document sync response commit LSN is stale");
  }
}

function documentSyncManifestEpoch(plan: DocumentSyncPlan): number {
  if (!isPlainRecord(plan.documentManifest.state)) {
    throw new Error("Document sync manifest state is invalid");
  }

  return readRecordNumber(
    plan.documentManifest.state,
    "epoch",
    "Document sync manifest state",
  );
}

function expectedDocumentMissingUpdateEpochs(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): DocumentSyncResponse["missingUpdateEpochs"] {
  const currentAccessEpoch = documentSyncManifestEpoch(plan);
  let hasPriorEpochUpdate = false;
  let hasCurrentEpochUpdate = false;

  for (const update of response.updates) {
    if (update.accessEpoch > currentAccessEpoch) {
      throw new Error("Document sync response includes a future access epoch");
    }
    if (update.accessEpoch < currentAccessEpoch) {
      hasPriorEpochUpdate = true;
    } else {
      hasCurrentEpochUpdate = true;
    }
  }

  const missingUpdateEpochs: DocumentSyncResponse["missingUpdateEpochs"] = [];
  if (hasPriorEpochUpdate) {
    missingUpdateEpochs.push("prior_epoch");
  }
  if (hasCurrentEpochUpdate) {
    missingUpdateEpochs.push("current_epoch");
  }

  return missingUpdateEpochs;
}

function assertDocumentMissingUpdateEpochsMatchPlan(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  const expected = expectedDocumentMissingUpdateEpochs(plan, response);
  if (
    response.missingUpdateEpochs.length !== expected.length ||
    response.missingUpdateEpochs.some(
      (epoch, index) => epoch !== expected[index],
    )
  ) {
    throw new Error("Document sync response missing update epochs mismatch");
  }
}

export async function persistedDocumentSyncStateFromResponse(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
  options: {
    resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
    writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
  } = {},
): Promise<PersistedDocumentSyncState> {
  if (response.documentId !== plan.documentId) {
    throw new Error("Document sync response document id mismatch");
  }
  if (
    serializeCanonical(response.contentKeyBundle, "content-key bundle") !==
    serializeCanonical(plan.sourceContentKeyBundle, "content-key bundle")
  ) {
    throw new Error("Document sync response content-key bundle mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets, "KEK targets") !==
    serializeCanonical(plan.documentKekTargets, "KEK targets")
  ) {
    throw new Error("Document sync response KEK target mismatch");
  }
  assertAcceptedOutgoingUpdateIdsMatchPlan(plan, response);
  assertDocumentSyncCommitCheckpointMatchesPlan(plan, response);
  assertDocumentMissingUpdateEpochsMatchPlan(plan, response);

  await Promise.all(
    response.updates.map((update) =>
      assertDocumentSyncResponseUpdateMatchesPlan({
        plan,
        resolveWriterPublicKey: options.resolveWriterPublicKey,
        update,
        writerPublicKeysByFingerprint: options.writerPublicKeysByFingerprint,
      }),
    ),
  );

  return {
    documentId: plan.documentId,
    contentKeyBundle: serializeState(response.contentKeyBundle),
    documentKekTargets: serializeState(response.documentKekTargets),
    documentManifestBundle: serializeState(plan.documentManifest),
  };
}

const RETRYABLE_DOCUMENT_SYNC_CONFLICT_MESSAGES = [
  "Document KEK targets are stale",
  "Document content-key bundle is stale",
  "Document write authorization manifest does not match sync request",
];

function isRetryableDocumentSyncConflict(
  failure: DocumentSyncSubmitFailure,
): boolean {
  if (failure.status !== 409) {
    return false;
  }

  return (
    RETRYABLE_DOCUMENT_SYNC_CONFLICT_MESSAGES.some((message) =>
      failure.message.includes(message),
    ) ||
    (failure.message.includes("authorizingContainerPaths") &&
      failure.message.includes("is stale")) ||
    (failure.message.includes("targetContainerPath") &&
      failure.message.includes("is stale"))
  );
}

async function submitDocumentSync(input: {
  apiClient: DocumentSyncApi;
  plan: DocumentSyncPlan;
}): Promise<DocumentSyncSubmitResult | null> {
  if (input.apiClient.syncDocumentResult) {
    const result = await input.apiClient.syncDocumentResult(
      input.plan.documentId,
      input.plan.request,
      { reportErrors: false },
    );

    if (result.ok) {
      return {
        ok: true,
        response: result.data,
      };
    }

    return result;
  }

  const response = await input.apiClient.syncDocument(
    input.plan.documentId,
    input.plan.request,
  );
  return response ? { ok: true, response } : null;
}

export async function syncRemoteDocument(input: {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  documentId: string;
  execSql?: ExecSql | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<SyncRemoteDocumentResult | null> {
  const maxAttempts = input.apiClient.syncDocumentResult ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const writerProjection = await input.apiClient.getDocumentWriterProjection(
      input.documentId,
    );
    if (!writerProjection) {
      return null;
    }
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author: input.author,
      execSql: input.execSql,
      localVersionVector: input.localVersionVector,
      minLsn: input.minLsn,
      pendingUpdates: input.pendingUpdates,
      signedAt: input.signedAt,
      targetSecretKey: input.targetSecretKey,
      writerProjection,
    });
    const plan = materializedPlan.plan;
    const submitted = await submitDocumentSync({
      apiClient: input.apiClient,
      plan,
    });
    if (!submitted) {
      return null;
    }
    if (!submitted.ok) {
      if (attempt < maxAttempts && isRetryableDocumentSyncConflict(submitted)) {
        continue;
      }

      submitted.report();
      return null;
    }

    const response = submitted.response;
    const persistedState = await persistedDocumentSyncStateFromResponse(
      plan,
      response,
      {
        resolveWriterPublicKey: input.resolveWriterPublicKey,
        writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
      },
    );

    return {
      contentKey: materializedPlan.contentKey,
      decryptedUpdates: await decryptDocumentSyncUpdates({
        contentKey: materializedPlan.contentKey,
        contentKeyEpoch: plan.contentKeyEpoch,
        documentId: plan.documentId,
        organizationId: plan.organizationId,
        updates: response.updates,
      }),
      persistedState,
      plan,
      response,
      writerProjection,
    };
  }

  return null;
}

function serializeState(value: unknown): string {
  return JSON.stringify(value);
}

function serializeCanonical(value: unknown, label: string): string {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new Error(`Document create response ${label} is invalid`);
  }

  return serializeKeyingCanonicalJson(
    readCanonicalJson(value, `Document create response ${label}`),
  );
}

function assertCreateResponseMatchesPlan(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): void {
  if (response.id !== plan.documentId) {
    throw new Error("Document create response id mismatch");
  }
  if (response.accessManifest.manifestHash !== plan.manifestHash) {
    throw new Error("Document create response manifest hash mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.manifest, "manifest") !==
    serializeCanonical(plan.manifest, "manifest")
  ) {
    throw new Error("Document create response manifest mismatch");
  }

  const responseEvent = response.accessManifest.event;
  if (!isPlainRecord(responseEvent)) {
    throw new Error("Document create response event bundle is invalid");
  }
  if (
    readRecordString(responseEvent, "eventHash", "event bundle") !==
    plan.eventHash
  ) {
    throw new Error("Document create response event hash mismatch");
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "event"), "event") !==
    serializeCanonical(plan.event, "event")
  ) {
    throw new Error("Document create response event mismatch");
  }

  const responseState = response.accessManifest.state;
  if (!isPlainRecord(responseState)) {
    throw new Error("Document create response state is invalid");
  }
  if (
    readRecordString(responseState, "documentId", "document state") !==
    plan.documentId
  ) {
    throw new Error("Document create response document id mismatch");
  }
  if (
    serializeCanonical(responseState, "state") !==
    serializeCanonical(plan.state, "state")
  ) {
    throw new Error("Document create response state mismatch");
  }

  if (response.contentKeyBundle.documentId !== plan.documentId) {
    throw new Error("Document create response content-key document mismatch");
  }
  if (
    response.contentKeyBundle.contentKeyEpoch !==
    plan.request.contentKeyBundle.contentKeyEpoch
  ) {
    throw new Error("Document create response content-key epoch mismatch");
  }
  if (response.contentKeyBundle.linkSetManifestHash !== plan.manifestHash) {
    throw new Error("Document create response link manifest mismatch");
  }
  if (response.contentKeyBundle.targetHash !== plan.targetHash) {
    throw new Error("Document create response target hash mismatch");
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
    throw new Error("Document create response content-key targets mismatch");
  }
  if (response.documentKekTargets.documentId !== plan.documentId) {
    throw new Error("Document create response target document mismatch");
  }
  if (response.documentKekTargets.linkSetManifestHash !== plan.manifestHash) {
    throw new Error("Document create response target manifest mismatch");
  }
  if (response.documentKekTargets.documentKeyTargetHash !== plan.targetHash) {
    throw new Error("Document create response document target hash mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets.targets, "KEK targets") !==
    serializeCanonical(plan.targets, "KEK targets")
  ) {
    throw new Error("Document create response KEK targets mismatch");
  }
}

export function persistedDocumentCreateStateFromResponse(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): PersistedDocumentCreateState {
  assertCreateResponseMatchesPlan(plan, response);

  return {
    documentId: response.id,
    contentKeyBundle: serializeState(response.contentKeyBundle),
    documentKekTargets: serializeState(response.documentKekTargets),
    documentManifestBundle: serializeState(response.accessManifest),
  };
}
