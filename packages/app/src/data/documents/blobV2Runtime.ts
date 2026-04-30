import {
  type AccessEventV2,
  type AttachmentBindAccessEventBodyV2,
  CONTENT_RECORD_ENCRYPTION_SUITE_V2,
  computeAccessEventBodyHash,
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  computeContentRecordNonceDomainHash,
  computeWriteHeaderHash,
  decryptWithDek,
  encryptWithDek,
  type KeyingV2CanonicalJson,
  serializeKeyingV2CanonicalJson,
  signAccessEvent,
  signWriteHeader,
  toFingerprint,
  type UnsignedAccessEventV2,
  type WriteHeaderV2,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  BlobV2AttachmentBindRequest,
  BlobV2ContentKeyBundleRequest,
  BlobV2ContentKeyTargetEnvelopeRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobV2AttachmentBindResponse,
  DocumentV2WriterProjectionResponse,
  StageBlobResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../blobs";
import {
  readCanonicalJson,
  readCanonicalRecord,
  readCanonicalRecordPaths,
} from "../keyingV2CanonicalJson";
import type { ExecSql } from "../persistence/sqlSchema";
import {
  assertDocumentV2WriterProjectionConsistent,
  type DocumentV2CreateAuthor,
  unwrapContainerV2KekPath,
} from "./documentV2Runtime";

const BLOB_V2_CONTENT_KEY_WRAP_SUITE =
  "tearleads.blob-v2.content-key-wrap.aes-256-gcm-container-kek";
const BLOB_V2_ENCRYPTED_BYTES_FORMAT = "tearleads.blob-v2.bytes";
const BLOB_V2_CONTENT_RECORD_KEY_INFO_DOMAIN =
  "tearleads.blob-v2.content-record-key-info";
const BLOB_V2_CONTENT_RECORD_AAD_DOMAIN =
  "tearleads.blob-v2.content-record-aad";
const BLOB_V2_CONTENT_RECORD_METADATA_HASH_DOMAIN =
  "tearleads.blob-v2.content-record-metadata";
const BLOB_V2_CONTENT_RECORD_HKDF_SALT: Uint8Array<ArrayBuffer> =
  new TextEncoder().encode("tearleads.blob-v2.content-record-hkdf-salt");
const BLOB_V2_CONTENT_RECORD_IV: Uint8Array<ArrayBuffer> = new Uint8Array(12);
const BLOB_V2_ENCRYPTED_BYTES_KEYS = new Set([
  "blobId",
  "byteLength",
  "ciphertext",
  "contentKeyBundle",
  "contentKeyEpoch",
  "contentRecordId",
  "encryptionSuite",
  "format",
  "iv",
  "metadataHash",
  "nonceDomainHash",
  "targetHash",
  "version",
]);
const TEXT_ENCODER = new TextEncoder();

interface BlobV2AttachmentApi {
  bindBlobAttachmentV2(
    blobId: string,
    input: BlobV2AttachmentBindRequest,
  ): Promise<BlobV2AttachmentBindResponse | null>;
  getDocumentV2WriterProjection(
    documentId: string,
  ): Promise<DocumentV2WriterProjectionResponse | null>;
  stageBlob(input: StageBlobRequest): Promise<StageBlobResponse | null>;
}

interface BlobContentKeyTarget {
  bindingId: string;
  documentId: string;
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
}

interface BlobV2EncryptedBytesRecord {
  blobId: string;
  byteLength: number;
  ciphertext: Uint8Array;
  contentKeyBundle: BlobV2ContentKeyBundleRequest;
  contentKeyEpoch: number;
  contentRecordId: string;
  metadataHash: string;
  nonceDomainHash: string;
  targetHash: string;
}

interface BlobV2EncryptedBytes {
  encryptedBytes: string;
  metadataHash: string;
  sha256: string;
}

interface DocumentManifestIdentity {
  documentId: string;
  manifestHash: string;
  organizationId: string;
}

interface BlobAttachmentMaterial {
  blobAccessManifestHash: string;
  contentKeyBundle: BlobV2ContentKeyBundleRequest;
  encrypted: BlobV2EncryptedBytes;
  manifestIdentity: DocumentManifestIdentity;
  targetHash: string;
  targets: BlobContentKeyTarget[];
  writerProjection: DocumentV2WriterProjectionResponse;
}

interface UploadDocumentAttachmentV2Input {
  apiClient: BlobV2AttachmentApi;
  author: DocumentV2CreateAuthor;
  blobId?: string | undefined;
  bindingId?: string | undefined;
  bytes: BlobBytes;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId: string;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  expectedBindingId: string | null;
  signedAt?: string | undefined;
  slotId: string;
  targetSecretKey: Uint8Array;
}

interface UploadDocumentAttachmentV2Result {
  blobId: string;
  bindingId: string;
  encryptedBytes: string;
  request: BlobV2AttachmentBindRequest;
  response: BlobV2AttachmentBindResponse;
  sha256: string;
  writeHeader: WriteHeaderV2;
  writeHeaderHash: string;
}

interface DecryptDocumentAttachmentBlobV2Input {
  encryptedBytes: string;
  expectedBindingId: string;
  expectedBlobId: string;
  execSql?: ExecSql | undefined;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentV2WriterProjectionResponse;
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

function asWebCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!(bytes.buffer instanceof ArrayBuffer)) {
    throw new Error("Blob V2 byte material must be ArrayBuffer-backed");
  }
  return bytes as Uint8Array<ArrayBuffer>;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function targetKey(target: BlobContentKeyTarget): string {
  return [
    target.bindingId,
    target.documentId,
    target.containerId,
    target.containerManifestHash,
    target.containerKeyEpochId,
    String(target.containerKeyEpoch),
  ].join(":");
}

function sortBlobTargets<T extends BlobContentKeyTarget>(
  targets: readonly T[],
) {
  return [...targets].sort((left, right) =>
    targetKey(left).localeCompare(targetKey(right)),
  );
}

function serializeCanonical(value: unknown, label: string): string {
  return serializeKeyingV2CanonicalJson(readCanonicalJson(value, label));
}

function readDocumentManifestIdentity(
  writerProjection: DocumentV2WriterProjectionResponse,
): DocumentManifestIdentity {
  const { documentManifest } = writerProjection;
  if (!isPlainRecord(documentManifest.state)) {
    throw new Error("Document V2 writer projection manifest state is invalid");
  }

  const documentId = readRecordString(
    documentManifest.state,
    "documentId",
    "Document V2 writer projection manifest state",
  );
  if (documentId !== writerProjection.documentId) {
    throw new Error(
      "Document V2 writer projection document id is inconsistent",
    );
  }

  return {
    documentId,
    manifestHash: documentManifest.manifestHash,
    organizationId: readRecordString(
      documentManifest.state,
      "organizationId",
      "Document V2 writer projection manifest state",
    ),
  };
}

function normalizeDocumentTarget(
  value: Record<string, unknown>,
): Omit<BlobContentKeyTarget, "bindingId" | "documentId"> {
  return {
    containerId: readRecordString(value, "containerId", "Document KEK target"),
    containerManifestHash: readRecordString(
      value,
      "containerManifestHash",
      "Document KEK target",
    ),
    containerKeyEpochId: readRecordString(
      value,
      "containerKeyEpochId",
      "Document KEK target",
    ),
    containerKeyEpoch: readRecordNumber(
      value,
      "containerKeyEpoch",
      "Document KEK target",
    ),
  };
}

function deriveBlobTargetsFromDocumentProjection(input: {
  bindingId: string;
  documentId: string;
  writerProjection: DocumentV2WriterProjectionResponse;
}): BlobContentKeyTarget[] {
  return sortBlobTargets(
    input.writerProjection.documentKekTargets.targets.map((target) => ({
      bindingId: input.bindingId,
      documentId: input.documentId,
      ...normalizeDocumentTarget(target),
    })),
  );
}

async function collectContainerKeks(input: {
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
  writerProjection: DocumentV2WriterProjectionResponse;
}): Promise<ReadonlyMap<string, Uint8Array>> {
  const keksByEpochId = new Map<string, Uint8Array>();

  for (const projection of input.writerProjection.authorizingContainerPaths) {
    const projectionKeks = await unwrapContainerV2KekPath({
      execSql: input.execSql,
      projection,
      secretKey: input.secretKey,
    });

    for (const [containerKeyEpochId, keyMaterial] of projectionKeks) {
      const existing = keksByEpochId.get(containerKeyEpochId);
      if (existing) {
        if (
          existing.byteLength !== keyMaterial.byteLength ||
          existing.some((byte, index) => byte !== keyMaterial[index])
        ) {
          throw new Error(
            "Blob V2 writer projection contains conflicting container KEKs",
          );
        }
        continue;
      }
      keksByEpochId.set(containerKeyEpochId, keyMaterial);
    }
  }

  return keksByEpochId;
}

async function wrapBlobContentKey(input: {
  contentKey: Uint8Array;
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
  targets: readonly BlobContentKeyTarget[];
  writerProjection: DocumentV2WriterProjectionResponse;
}): Promise<BlobV2ContentKeyTargetEnvelopeRequest[]> {
  const keksByEpochId = await collectContainerKeks({
    execSql: input.execSql,
    secretKey: input.secretKey,
    writerProjection: input.writerProjection,
  });

  return Promise.all(
    input.targets.map(async (target) => {
      const targetKek = keksByEpochId.get(target.containerKeyEpochId);
      if (!targetKek) {
        throw new Error(
          `Blob V2 target KEK could not be unwrapped for ${target.containerKeyEpochId}`,
        );
      }

      const wrapped = await encryptWithDek(input.contentKey, targetKek);
      return {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: BLOB_V2_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      };
    }),
  );
}

async function unwrapBlobContentKeyTarget(input: {
  containerKek: Uint8Array;
  envelope: BlobV2ContentKeyTargetEnvelopeRequest;
}): Promise<Uint8Array> {
  const metadata = input.envelope.wrappingMetadata;
  const suite = isPlainRecord(metadata)
    ? Reflect.get(metadata, "suite")
    : undefined;
  const iv = isPlainRecord(metadata) ? Reflect.get(metadata, "iv") : undefined;
  if (suite !== BLOB_V2_CONTENT_KEY_WRAP_SUITE) {
    throw new Error("Blob V2 content-key target uses an unknown suite");
  }
  if (typeof iv !== "string" || iv.length === 0) {
    throw new Error("Blob V2 content-key target is missing an IV");
  }

  return decryptWithDek(
    {
      iv: base64ToBytes(iv),
      ciphertext: base64ToBytes(input.envelope.wrappedKey),
    },
    input.containerKek,
  );
}

function authorizingContainerPathRecords(
  writerProjection: DocumentV2WriterProjectionResponse,
): Record<string, unknown>[][] {
  return readCanonicalRecordPaths(
    writerProjection.authorizingContainerPaths.map(
      (projection) => projection.path,
    ),
    "Blob V2 authorizing container paths",
  );
}

async function blobContentMetadataHash(input: {
  blobId: string;
  byteLength: number;
  contentKeyEpoch: number;
  targetHash: string;
}): Promise<string> {
  return toFingerprint(
    TEXT_ENCODER.encode(
      serializeKeyingV2CanonicalJson({
        domain: BLOB_V2_CONTENT_RECORD_METADATA_HASH_DOMAIN,
        payload: {
          version: 2,
          recordKind: "blob_bytes",
          blobId: input.blobId,
          byteLength: input.byteLength,
          contentKeyEpoch: input.contentKeyEpoch,
          targetHash: input.targetHash,
        },
      }),
    ),
  );
}

function contentRecordDerivationPayload(input: {
  blobId: string;
  contentKeyEpoch: number;
  contentRecordId: string;
  organizationId: string;
}): Record<string, KeyingV2CanonicalJson> {
  return {
    version: 2,
    organizationId: input.organizationId,
    objectKind: "blob",
    objectId: input.blobId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId: input.contentRecordId,
  };
}

function contentRecordDerivationBytes(input: {
  blobId: string;
  contentKeyEpoch: number;
  contentRecordId: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingV2CanonicalJson({
      domain: BLOB_V2_CONTENT_RECORD_KEY_INFO_DOMAIN,
      payload: contentRecordDerivationPayload(input),
    }),
  );
}

function contentRecordAdditionalDataBytes(input: {
  blobId: string;
  contentKeyEpoch: number;
  contentRecordId: string;
  metadataHash: string;
  nonceDomainHash: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingV2CanonicalJson({
      domain: BLOB_V2_CONTENT_RECORD_AAD_DOMAIN,
      payload: {
        ...contentRecordDerivationPayload(input),
        metadataHash: input.metadataHash,
        nonceDomainHash: input.nonceDomainHash,
      },
    }),
  );
}

async function importBlobContentKeyMaterial(
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

async function deriveBlobContentRecordKey(input: {
  blobId: string;
  contentKeyEpoch: number;
  contentKeyMaterial: CryptoKey;
  contentRecordId: string;
  organizationId: string;
  usage: "decrypt" | "encrypt";
}): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: BLOB_V2_CONTENT_RECORD_HKDF_SALT,
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

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function encryptBlobBytes(input: {
  blobId: string;
  bytes: BlobBytes;
  contentKey: Uint8Array;
  contentKeyBundle: BlobV2ContentKeyBundleRequest;
  organizationId: string;
}): Promise<BlobV2EncryptedBytes> {
  const contentRecordId = input.blobId;
  const { contentKeyEpoch, targetHash } = input.contentKeyBundle;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 2,
    organizationId: input.organizationId,
    objectKind: "blob",
    objectId: input.blobId,
    contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId,
  });
  const metadataHash = await blobContentMetadataHash({
    blobId: input.blobId,
    byteLength: input.bytes.byteLength,
    contentKeyEpoch,
    targetHash,
  });
  const contentKeyMaterial = await importBlobContentKeyMaterial(
    input.contentKey,
  );
  const recordKey = await deriveBlobContentRecordKey({
    blobId: input.blobId,
    contentKeyEpoch,
    contentKeyMaterial,
    contentRecordId,
    organizationId: input.organizationId,
    usage: "encrypt",
  });
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: BLOB_V2_CONTENT_RECORD_IV,
        additionalData: contentRecordAdditionalDataBytes({
          blobId: input.blobId,
          contentKeyEpoch,
          contentRecordId,
          metadataHash,
          nonceDomainHash,
          organizationId: input.organizationId,
        }),
      },
      recordKey,
      asWebCryptoBytes(input.bytes),
    ),
  );
  const encryptedBytes = serializeKeyingV2CanonicalJson({
    format: BLOB_V2_ENCRYPTED_BYTES_FORMAT,
    version: 2,
    blobId: input.blobId,
    byteLength: input.bytes.byteLength,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentKeyEpoch,
    contentRecordId,
    nonceDomainHash,
    metadataHash,
    targetHash,
    contentKeyBundle: readCanonicalJson(
      input.contentKeyBundle,
      "Blob V2 encrypted bytes content-key bundle",
    ),
    iv: bytesToBase64(BLOB_V2_CONTENT_RECORD_IV),
    ciphertext: bytesToBase64(ciphertext),
  });

  return {
    encryptedBytes,
    metadataHash,
    sha256: await sha256Hex(encryptedBytes),
  };
}

function readContentKeyBundle(value: unknown): BlobV2ContentKeyBundleRequest {
  if (!isPlainRecord(value)) {
    throw new Error("Blob V2 content-key bundle must be an object");
  }
  const targets = Reflect.get(value, "targets");
  if (!Array.isArray(targets) || !targets.every(isPlainRecord)) {
    throw new Error("Blob V2 content-key bundle targets are invalid");
  }

  return {
    contentKeyEpoch: readRecordNumber(
      value,
      "contentKeyEpoch",
      "Blob V2 content-key bundle",
    ),
    targetHash: readRecordString(
      value,
      "targetHash",
      "Blob V2 content-key bundle",
    ),
    targets: targets.map((target) => {
      const wrappingMetadata = Reflect.get(target, "wrappingMetadata");
      return {
        bindingId: readRecordString(target, "bindingId", "Blob V2 target"),
        documentId: readRecordString(target, "documentId", "Blob V2 target"),
        containerId: readRecordString(target, "containerId", "Blob V2 target"),
        containerManifestHash: readRecordString(
          target,
          "containerManifestHash",
          "Blob V2 target",
        ),
        containerKeyEpochId: readRecordString(
          target,
          "containerKeyEpochId",
          "Blob V2 target",
        ),
        containerKeyEpoch: readRecordNumber(
          target,
          "containerKeyEpoch",
          "Blob V2 target",
        ),
        wrappedKey: readRecordString(target, "wrappedKey", "Blob V2 target"),
        wrappingMetadata: isPlainRecord(wrappingMetadata)
          ? wrappingMetadata
          : {},
      };
    }),
  };
}

function parseBlobV2EncryptedBytes(
  encryptedBytes: string,
): BlobV2EncryptedBytesRecord {
  let value: unknown;
  try {
    value = JSON.parse(encryptedBytes);
  } catch {
    throw new Error("Blob V2 encrypted bytes are invalid JSON");
  }
  if (!isPlainRecord(value)) {
    throw new Error("Blob V2 encrypted bytes must be an object");
  }
  assertOnlyRecordKeys(
    value,
    BLOB_V2_ENCRYPTED_BYTES_KEYS,
    "Blob V2 encrypted bytes",
  );
  if (
    readRecordString(value, "format", "Blob V2 encrypted bytes") !==
    BLOB_V2_ENCRYPTED_BYTES_FORMAT
  ) {
    throw new Error("Blob V2 encrypted bytes format is invalid");
  }
  const version = readRecordNumber(value, "version", "Blob V2 encrypted bytes");
  if (version !== 2) {
    throw new Error(
      `Blob V2 encrypted bytes version ${version} is invalid; expected 2`,
    );
  }
  if (
    readRecordString(value, "encryptionSuite", "Blob V2 encrypted bytes") !==
    CONTENT_RECORD_ENCRYPTION_SUITE_V2
  ) {
    throw new Error("Blob V2 encrypted bytes suite is invalid");
  }

  const iv = base64ToBytes(
    readRecordString(value, "iv", "Blob V2 encrypted bytes"),
  );
  if (
    iv.byteLength !== BLOB_V2_CONTENT_RECORD_IV.byteLength ||
    iv.some((byte, index) => byte !== BLOB_V2_CONTENT_RECORD_IV[index])
  ) {
    throw new Error("Blob V2 encrypted bytes IV is invalid");
  }

  return {
    blobId: readRecordString(value, "blobId", "Blob V2 encrypted bytes"),
    byteLength: readRecordNumber(
      value,
      "byteLength",
      "Blob V2 encrypted bytes",
    ),
    ciphertext: base64ToBytes(
      readRecordString(value, "ciphertext", "Blob V2 encrypted bytes"),
    ),
    contentKeyBundle: readContentKeyBundle(
      Reflect.get(value, "contentKeyBundle"),
    ),
    contentKeyEpoch: readRecordNumber(
      value,
      "contentKeyEpoch",
      "Blob V2 encrypted bytes",
    ),
    contentRecordId: readRecordString(
      value,
      "contentRecordId",
      "Blob V2 encrypted bytes",
    ),
    metadataHash: readRecordString(
      value,
      "metadataHash",
      "Blob V2 encrypted bytes",
    ),
    nonceDomainHash: readRecordString(
      value,
      "nonceDomainHash",
      "Blob V2 encrypted bytes",
    ),
    targetHash: readRecordString(
      value,
      "targetHash",
      "Blob V2 encrypted bytes",
    ),
  };
}

async function unwrapBlobContentKey(input: {
  documentId: string;
  encrypted: BlobV2EncryptedBytesRecord;
  execSql?: ExecSql | undefined;
  expectedBindingId: string;
  secretKey: Uint8Array;
  writerProjection: DocumentV2WriterProjectionResponse;
}): Promise<Uint8Array> {
  const keksByEpochId = await collectContainerKeks({
    execSql: input.execSql,
    secretKey: input.secretKey,
    writerProjection: input.writerProjection,
  });
  let contentKey: Uint8Array | null = null;
  const attachmentTargets = input.encrypted.contentKeyBundle.targets.filter(
    (envelope) =>
      envelope.bindingId === input.expectedBindingId &&
      envelope.documentId === input.documentId,
  );

  if (attachmentTargets.length === 0) {
    throw new Error("Blob V2 content-key bundle is missing attachment target");
  }

  for (const envelope of attachmentTargets) {
    const containerKek = keksByEpochId.get(envelope.containerKeyEpochId);
    if (!containerKek) {
      continue;
    }
    const unwrapped = await unwrapBlobContentKeyTarget({
      containerKek,
      envelope,
    });
    if (contentKey) {
      if (
        contentKey.byteLength !== unwrapped.byteLength ||
        contentKey.some((byte, index) => byte !== unwrapped[index])
      ) {
        throw new Error(
          "Blob V2 content-key targets unwrap to conflicting keys",
        );
      }
      continue;
    }
    contentKey = unwrapped;
  }

  if (!contentKey) {
    throw new Error("Blob V2 content key could not be unwrapped");
  }
  return contentKey;
}

function contentKeyTargetReference(
  envelope: BlobV2ContentKeyTargetEnvelopeRequest,
): BlobContentKeyTarget {
  return {
    bindingId: envelope.bindingId,
    documentId: envelope.documentId,
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

function readBlobKekTarget(
  value: Record<string, unknown>,
  label: string,
): BlobContentKeyTarget {
  return {
    bindingId: readRecordString(value, "bindingId", label),
    documentId: readRecordString(value, "documentId", label),
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

async function assertBlobContentKeyBundleTargetHash(
  bundle: BlobV2ContentKeyBundleRequest,
): Promise<void> {
  const targetHash = await computeBlobContentKeyTargetHash(
    bundle.targets.map(contentKeyTargetReference),
  );
  if (targetHash !== bundle.targetHash) {
    throw new Error("Blob V2 content-key target hash is not canonical");
  }
}

function normalizedBlobContentKeyBundle(
  bundle: BlobV2ContentKeyBundleRequest,
): BlobV2ContentKeyBundleRequest {
  return {
    contentKeyEpoch: bundle.contentKeyEpoch,
    targetHash: bundle.targetHash,
    targets: sortBlobTargets(bundle.targets),
  };
}

function assertStringSetsEqual(input: {
  actual: readonly string[];
  expected: readonly string[];
  message: string;
}): void {
  const actual = uniqueSortedStrings(input.actual);
  const expected = uniqueSortedStrings(input.expected);
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(input.message);
  }
}

async function assertBlobAttachmentBindResponseTargets(input: {
  bindingId: string;
  blobId: string;
  contentKeyBundle: BlobV2ContentKeyBundleRequest;
  manifestIdentity: DocumentManifestIdentity;
  response: BlobV2AttachmentBindResponse;
  targetHash: string;
  targets: readonly BlobContentKeyTarget[];
}): Promise<void> {
  // The bind route echoes key material that the client will persist and use for
  // future decrypts. Treat it as untrusted until it canonically matches the
  // request-derived targets and summaries.
  if (input.response.contentKeyBundle.blobId !== input.blobId) {
    throw new Error("Blob V2 attachment bind response blob id mismatch");
  }

  const responseContentKeyBundle = normalizedBlobContentKeyBundle({
    contentKeyEpoch: input.response.contentKeyBundle.contentKeyEpoch,
    targetHash: input.response.contentKeyBundle.targetHash,
    targets: input.response.contentKeyBundle.targets,
  });
  await assertBlobContentKeyBundleTargetHash(responseContentKeyBundle);
  if (
    serializeCanonical(
      responseContentKeyBundle,
      "Blob V2 attachment bind response content-key bundle",
    ) !==
    serializeCanonical(
      normalizedBlobContentKeyBundle(input.contentKeyBundle),
      "Blob V2 attachment bind request content-key bundle",
    )
  ) {
    throw new Error(
      "Blob V2 attachment bind response content-key bundle mismatch",
    );
  }

  const responseTargets = sortBlobTargets(
    input.response.blobKekTargets.targets.map((target, index) =>
      readBlobKekTarget(
        target,
        `Blob V2 attachment bind response KEK target[${index}]`,
      ),
    ),
  );
  const expectedTargets = sortBlobTargets(input.targets);
  if (
    serializeCanonical(
      responseTargets,
      "Blob V2 attachment bind response KEK targets",
    ) !==
    serializeCanonical(
      expectedTargets,
      "Blob V2 attachment bind request KEK targets",
    )
  ) {
    throw new Error("Blob V2 attachment bind response KEK targets mismatch");
  }

  if (
    input.response.blobKekTargets.blobId !== input.blobId ||
    input.response.blobKekTargets.organizationId !==
      input.manifestIdentity.organizationId ||
    input.response.blobKekTargets.blobKeyTargetHash !== input.targetHash
  ) {
    throw new Error("Blob V2 attachment bind response KEK summary mismatch");
  }
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.activeBindingIds,
    expected: [input.bindingId],
    message: "Blob V2 attachment bind response active bindings mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.documentManifestHashes,
    expected: [input.manifestIdentity.manifestHash],
    message: "Blob V2 attachment bind response document manifests mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.linkedContainerManifestHashes,
    expected: expectedTargets.map((target) => target.containerManifestHash),
    message: "Blob V2 attachment bind response container manifests mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.linkedContainerKeyEpochIds,
    expected: expectedTargets.map((target) => target.containerKeyEpochId),
    message: "Blob V2 attachment bind response container KEKs mismatch",
  });
}

export async function decryptDocumentAttachmentBlobV2({
  encryptedBytes,
  expectedBindingId,
  expectedBlobId,
  execSql,
  targetSecretKey,
  writerProjection,
}: DecryptDocumentAttachmentBlobV2Input): Promise<BlobBytes> {
  const encrypted = parseBlobV2EncryptedBytes(encryptedBytes);
  if (
    encrypted.blobId !== expectedBlobId ||
    encrypted.contentRecordId !== expectedBlobId
  ) {
    throw new Error("Blob V2 encrypted bytes blob id mismatch");
  }
  if (
    encrypted.contentKeyEpoch !== encrypted.contentKeyBundle.contentKeyEpoch ||
    encrypted.targetHash !== encrypted.contentKeyBundle.targetHash
  ) {
    throw new Error("Blob V2 encrypted bytes content-key bundle mismatch");
  }
  await assertBlobContentKeyBundleTargetHash(encrypted.contentKeyBundle);

  await assertDocumentV2WriterProjectionConsistent(writerProjection);
  const { documentId, organizationId } =
    readDocumentManifestIdentity(writerProjection);
  const expectedNonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 2,
    organizationId,
    objectKind: "blob",
    objectId: expectedBlobId,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId: encrypted.contentRecordId,
  });
  if (encrypted.nonceDomainHash !== expectedNonceDomainHash) {
    throw new Error("Blob V2 encrypted bytes nonce domain mismatch");
  }
  const expectedMetadataHash = await blobContentMetadataHash({
    blobId: expectedBlobId,
    byteLength: encrypted.byteLength,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    targetHash: encrypted.targetHash,
  });
  if (encrypted.metadataHash !== expectedMetadataHash) {
    throw new Error("Blob V2 encrypted bytes metadata hash mismatch");
  }

  const contentKey = await unwrapBlobContentKey({
    documentId,
    encrypted,
    execSql,
    expectedBindingId,
    secretKey: targetSecretKey,
    writerProjection,
  });
  const contentKeyMaterial = await importBlobContentKeyMaterial(contentKey);
  const recordKey = await deriveBlobContentRecordKey({
    blobId: expectedBlobId,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    contentKeyMaterial,
    contentRecordId: encrypted.contentRecordId,
    organizationId,
    usage: "decrypt",
  });
  const decrypted = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: BLOB_V2_CONTENT_RECORD_IV,
        additionalData: contentRecordAdditionalDataBytes({
          blobId: expectedBlobId,
          contentKeyEpoch: encrypted.contentKeyEpoch,
          contentRecordId: encrypted.contentRecordId,
          metadataHash: encrypted.metadataHash,
          nonceDomainHash: encrypted.nonceDomainHash,
          organizationId,
        }),
      },
      recordKey,
      asWebCryptoBytes(encrypted.ciphertext),
    ),
  );

  if (decrypted.byteLength !== encrypted.byteLength) {
    throw new Error("Blob V2 decrypted byte length mismatch");
  }

  return decrypted as BlobBytes;
}

async function buildBlobAttachmentMaterial(input: {
  apiClient: BlobV2AttachmentApi;
  bindingId: string;
  blobId: string;
  bytes: BlobBytes;
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  documentId: string;
  execSql?: ExecSql | undefined;
  targetSecretKey: Uint8Array;
}): Promise<BlobAttachmentMaterial | null> {
  const writerProjection = await input.apiClient.getDocumentV2WriterProjection(
    input.documentId,
  );
  if (!writerProjection) {
    return null;
  }

  await assertDocumentV2WriterProjectionConsistent(writerProjection);
  const manifestIdentity = readDocumentManifestIdentity(writerProjection);
  if (manifestIdentity.documentId !== input.documentId) {
    throw new Error(
      "Blob V2 attachment writer projection targets wrong document",
    );
  }

  const targets = deriveBlobTargetsFromDocumentProjection({
    bindingId: input.bindingId,
    documentId: input.documentId,
    writerProjection,
  });
  const targetHash = await computeBlobContentKeyTargetHash(targets);
  const contentKeyBundle: BlobV2ContentKeyBundleRequest = {
    contentKeyEpoch: input.contentKeyEpoch,
    targetHash,
    targets: await wrapBlobContentKey({
      contentKey: input.contentKey,
      execSql: input.execSql,
      secretKey: input.targetSecretKey,
      targets,
      writerProjection,
    }),
  };
  const encrypted = await encryptBlobBytes({
    blobId: input.blobId,
    bytes: input.bytes,
    contentKey: input.contentKey,
    contentKeyBundle,
    organizationId: manifestIdentity.organizationId,
  });
  const blobAccessManifestHash = await computeBlobAccessManifestHash({
    version: 2,
    blobId: input.blobId,
    organizationId: manifestIdentity.organizationId,
    activeBindingIds: [input.bindingId],
    documentManifestHashes: [manifestIdentity.manifestHash],
    linkedContainerManifestHashes: uniqueSortedStrings(
      targets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      targets.map((target) => target.containerKeyEpochId),
    ),
    blobKeyTargetHash: targetHash,
  });

  return {
    blobAccessManifestHash,
    contentKeyBundle,
    encrypted,
    manifestIdentity,
    targetHash,
    targets,
    writerProjection,
  };
}

async function signBlobAttachmentEvent(input: {
  author: DocumentV2CreateAuthor;
  bindingId: string;
  blobId: string;
  documentId: string;
  eventId: string;
  expectedBindingId: string | null;
  manifestIdentity: DocumentManifestIdentity;
  signedAt: string;
  slotId: string;
  targets: readonly BlobContentKeyTarget[];
}): Promise<{ body: AttachmentBindAccessEventBodyV2; event: AccessEventV2 }> {
  const body: AttachmentBindAccessEventBodyV2 = {
    eventType: "attachment.bind",
    bindingId: input.bindingId,
    blobId: input.blobId,
    documentId: input.documentId,
    slotId: input.slotId,
    expectedBindingId: input.expectedBindingId,
    documentManifestHash: input.manifestIdentity.manifestHash,
  };
  const unsignedEvent: UnsignedAccessEventV2 = {
    version: 2,
    eventId: input.eventId,
    eventType: "attachment.bind",
    objectKind: "blob",
    objectId: input.blobId,
    organizationId: input.manifestIdentity.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: uniqueSortedStrings([
      input.manifestIdentity.manifestHash,
      ...input.targets.map((target) => target.containerManifestHash),
    ]),
    bodyHash: await computeAccessEventBodyHash(
      readCanonicalJson(body, "Blob V2 attachment bind body"),
    ),
    signerUserId: input.author.signerUserId,
    signerDeviceId: input.author.signerDeviceId,
    signerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.signedAt,
  };

  return {
    body,
    event: await signAccessEvent(unsignedEvent, input.author.signerPrivateKey),
  };
}

async function signBlobAttachmentWriteHeader(input: {
  author: DocumentV2CreateAuthor;
  blobAccessManifestHash: string;
  blobId: string;
  contentKeyEpoch: number;
  encrypted: BlobV2EncryptedBytes;
  manifestIdentity: DocumentManifestIdentity;
  signedAt: string;
  targetHash: string;
}): Promise<{ writeHeader: WriteHeaderV2; writeHeaderHash: string }> {
  const writeHeader = await signWriteHeader(
    {
      version: 2,
      organizationId: input.manifestIdentity.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      accessManifestHash: input.blobAccessManifestHash,
      contentKeyEpoch: input.contentKeyEpoch,
      targetHash: input.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
      contentRecordId: input.blobId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 2,
        organizationId: input.manifestIdentity.organizationId,
        objectKind: "blob",
        objectId: input.blobId,
        contentKeyEpoch: input.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
        contentRecordId: input.blobId,
      }),
      metadataHash: input.encrypted.metadataHash,
      ciphertextHash: input.encrypted.sha256,
      writerUserId: input.author.signerUserId,
      writerDeviceId: input.author.signerDeviceId,
      writerKeyFingerprint: input.author.signerKeyFingerprint,
      signedAt: input.signedAt,
    },
    input.author.signerPrivateKey,
  );

  return {
    writeHeader,
    writeHeaderHash: await computeWriteHeaderHash(writeHeader),
  };
}

async function assertBlobAttachmentBindResponse(input: {
  bindingId: string;
  blobAccessManifestHash: string;
  blobId: string;
  contentKeyBundle: BlobV2ContentKeyBundleRequest;
  documentId: string;
  manifestIdentity: DocumentManifestIdentity;
  response: BlobV2AttachmentBindResponse;
  slotId: string;
  targetHash: string;
  targets: readonly BlobContentKeyTarget[];
  writeHeaderHash: string;
}): Promise<void> {
  if (
    input.response.blobId !== input.blobId ||
    input.response.bindingId !== input.bindingId ||
    input.response.documentId !== input.documentId ||
    input.response.slotId !== input.slotId ||
    input.response.blobKekTargets.blobAccessManifestHash !==
      input.blobAccessManifestHash ||
    input.response.writeHeaderHash !== input.writeHeaderHash
  ) {
    throw new Error("Blob V2 attachment bind response did not match request");
  }

  await assertBlobAttachmentBindResponseTargets(input);
}

function blobAttachmentStagedBlobRequest(
  stageId: string,
  writeHeader: WriteHeaderV2,
): NonNullable<BlobV2AttachmentBindRequest["stagedBlob"]> {
  return {
    stageId,
    writeHeader: readCanonicalRecord(
      writeHeader,
      "Blob V2 attachment write header",
    ),
  };
}

export async function uploadDocumentAttachmentV2({
  apiClient,
  author,
  blobId = crypto.randomUUID(),
  bindingId = crypto.randomUUID(),
  bytes,
  contentKey = crypto.getRandomValues(new Uint8Array(32)),
  contentKeyEpoch = 1,
  documentId,
  eventId = crypto.randomUUID(),
  execSql,
  expectedBindingId,
  signedAt = new Date().toISOString(),
  slotId,
  targetSecretKey,
}: UploadDocumentAttachmentV2Input): Promise<UploadDocumentAttachmentV2Result | null> {
  if (contentKey.byteLength !== 32) {
    throw new Error("Blob V2 content key must be 32 bytes");
  }

  const material = await buildBlobAttachmentMaterial({
    apiClient,
    bindingId,
    blobId,
    bytes,
    contentKey,
    contentKeyEpoch,
    documentId,
    execSql,
    targetSecretKey,
  });
  if (!material) {
    return null;
  }

  const { body, event } = await signBlobAttachmentEvent({
    author,
    bindingId,
    blobId,
    documentId,
    eventId,
    expectedBindingId,
    manifestIdentity: material.manifestIdentity,
    signedAt,
    slotId,
    targets: material.targets,
  });
  const { writeHeader, writeHeaderHash } = await signBlobAttachmentWriteHeader({
    author,
    blobAccessManifestHash: material.blobAccessManifestHash,
    blobId,
    contentKeyEpoch,
    encrypted: material.encrypted,
    manifestIdentity: material.manifestIdentity,
    signedAt,
    targetHash: material.targetHash,
  });
  const stage = await apiClient.stageBlob({
    encryptedBytes: material.encrypted.encryptedBytes,
    byteLength: TEXT_ENCODER.encode(material.encrypted.encryptedBytes)
      .byteLength,
    sha256: material.encrypted.sha256,
  });
  if (!stage) {
    return null;
  }

  const request: BlobV2AttachmentBindRequest = {
    event: readCanonicalRecord(event, "Blob V2 attachment bind event"),
    body: readCanonicalRecord(body, "Blob V2 attachment bind body"),
    documentManifest: material.writerProjection.documentManifest,
    authorizingContainerPaths: authorizingContainerPathRecords(
      material.writerProjection,
    ),
    contentKeyBundle: material.contentKeyBundle,
    stagedBlob: blobAttachmentStagedBlobRequest(stage.stageId, writeHeader),
  };
  const response = await apiClient.bindBlobAttachmentV2(blobId, request);
  if (!response) {
    return null;
  }

  await assertBlobAttachmentBindResponse({
    bindingId,
    blobAccessManifestHash: material.blobAccessManifestHash,
    blobId,
    contentKeyBundle: material.contentKeyBundle,
    documentId,
    manifestIdentity: material.manifestIdentity,
    response,
    slotId,
    targetHash: material.targetHash,
    targets: material.targets,
    writeHeaderHash,
  });

  return {
    blobId,
    bindingId,
    encryptedBytes: material.encrypted.encryptedBytes,
    request,
    response,
    sha256: material.encrypted.sha256,
    writeHeader,
    writeHeaderHash,
  };
}
