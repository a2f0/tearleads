import {
  type AccessEvent,
  type AttachmentBindAccessEventBody,
  assertAesGcmIv,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventBodyHash,
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  computeContentRecordNonceDomainHash,
  computeWriteHeaderHash,
  createAesGcmIv,
  decryptWithDek,
  encryptWithDek,
  type KeyingCanonicalJson,
  serializeKeyingCanonicalJson,
  signAccessEvent,
  signWriteHeader,
  toFingerprint,
  type UnsignedAccessEvent,
  type WriteHeader,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  BlobAttachmentBindRequest,
  BlobContentKeyBundleRequest,
  BlobContentKeyTargetEnvelopeRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  DocumentWriterProjectionResponse,
  StageBlobResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../blobs";
import {
  readCanonicalJson,
  readCanonicalRecord,
  readCanonicalRecordPaths,
} from "../keyingCanonicalJson";
import type { ProjectionUserKeyResolver } from "../keyingProjectionVerification";
import type { ExecSql } from "../persistence/sqlSchema";
import {
  assertDocumentWriterProjectionConsistent,
  type DocumentCreateAuthor,
  unwrapContainerKekPath,
} from "./documentRuntime";

const BLOB_CONTENT_KEY_WRAP_SUITE =
  "tearleads.blob.content-key-wrap.aes-256-gcm-container-kek";
const BLOB_ENCRYPTED_BYTES_FORMAT = "tearleads.blob.bytes";
const BLOB_CONTENT_RECORD_KEY_INFO_DOMAIN =
  "tearleads.blob.content-record-key-info";
const BLOB_CONTENT_RECORD_AAD_DOMAIN = "tearleads.blob.content-record-aad";
const BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN =
  "tearleads.blob.content-record-metadata";
const BLOB_CONTENT_RECORD_HKDF_SALT: Uint8Array<ArrayBuffer> =
  new TextEncoder().encode("tearleads.blob.content-record-hkdf-salt");
const BLOB_ENCRYPTED_BYTES_KEYS = new Set([
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

interface BlobAttachmentApi {
  bindBlobAttachment(
    blobId: string,
    input: BlobAttachmentBindRequest,
  ): Promise<BlobAttachmentBindResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
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

interface BlobEncryptedBytesRecord {
  blobId: string;
  byteLength: number;
  ciphertext: Uint8Array;
  contentKeyBundle: BlobContentKeyBundleRequest;
  contentKeyEpoch: number;
  contentRecordId: string;
  iv: Uint8Array;
  metadataHash: string;
  nonceDomainHash: string;
  targetHash: string;
}

interface BlobEncryptedBytes {
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
  contentKeyBundle: BlobContentKeyBundleRequest;
  encrypted: BlobEncryptedBytes;
  manifestIdentity: DocumentManifestIdentity;
  targetHash: string;
  targets: BlobContentKeyTarget[];
  writerProjection: DocumentWriterProjectionResponse;
}

interface UploadDocumentAttachmentInput {
  apiClient: BlobAttachmentApi;
  author: DocumentCreateAuthor;
  blobId?: string | undefined;
  bindingId?: string | undefined;
  bytes: BlobBytes;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId: string;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  expectedBindingId: string | null;
  resolveProjectionUserKey?: ProjectionUserKeyResolver | undefined;
  signedAt?: string | undefined;
  slotId: string;
  targetSecretKey: Uint8Array;
}

interface UploadDocumentAttachmentResult {
  blobId: string;
  bindingId: string;
  encryptedBytes: string;
  request: BlobAttachmentBindRequest;
  response: BlobAttachmentBindResponse;
  sha256: string;
  writeHeader: WriteHeader;
  writeHeaderHash: string;
}

interface DecryptDocumentAttachmentBlobInput {
  encryptedBytes: string;
  expectedBindingId: string;
  expectedBlobId: string;
  execSql?: ExecSql | undefined;
  resolveProjectionUserKey?: ProjectionUserKeyResolver | undefined;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
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
    throw new Error("Blob byte material must be ArrayBuffer-backed");
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
  return serializeKeyingCanonicalJson(readCanonicalJson(value, label));
}

function readDocumentManifestIdentity(
  writerProjection: DocumentWriterProjectionResponse,
): DocumentManifestIdentity {
  const { documentManifest } = writerProjection;
  if (!isPlainRecord(documentManifest.state)) {
    throw new Error("Document writer projection manifest state is invalid");
  }

  const documentId = readRecordString(
    documentManifest.state,
    "documentId",
    "Document writer projection manifest state",
  );
  if (documentId !== writerProjection.documentId) {
    throw new Error("Document writer projection document id is inconsistent");
  }

  return {
    documentId,
    manifestHash: documentManifest.manifestHash,
    organizationId: readRecordString(
      documentManifest.state,
      "organizationId",
      "Document writer projection manifest state",
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
  writerProjection: DocumentWriterProjectionResponse;
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
  resolveProjectionUserKey?: ProjectionUserKeyResolver | undefined;
  secretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<ReadonlyMap<string, Uint8Array>> {
  const keksByEpochId = new Map<string, Uint8Array>();

  for (const projection of input.writerProjection.authorizingContainerPaths) {
    const projectionKeks = await unwrapContainerKekPath({
      execSql: input.execSql,
      projection,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
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
            "Blob writer projection contains conflicting container KEKs",
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
  resolveProjectionUserKey?: ProjectionUserKeyResolver | undefined;
  secretKey: Uint8Array;
  targets: readonly BlobContentKeyTarget[];
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<BlobContentKeyTargetEnvelopeRequest[]> {
  const keksByEpochId = await collectContainerKeks({
    execSql: input.execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    secretKey: input.secretKey,
    writerProjection: input.writerProjection,
  });

  return Promise.all(
    input.targets.map(async (target) => {
      const targetKek = keksByEpochId.get(target.containerKeyEpochId);
      if (!targetKek) {
        throw new Error(
          `Blob target KEK could not be unwrapped for ${target.containerKeyEpochId}`,
        );
      }

      const wrapped = await encryptWithDek(input.contentKey, targetKek);
      return {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: BLOB_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      };
    }),
  );
}

async function unwrapBlobContentKeyTarget(input: {
  containerKek: Uint8Array;
  envelope: BlobContentKeyTargetEnvelopeRequest;
}): Promise<Uint8Array> {
  const metadata = input.envelope.wrappingMetadata;
  const suite = isPlainRecord(metadata)
    ? Reflect.get(metadata, "suite")
    : undefined;
  const iv = isPlainRecord(metadata) ? Reflect.get(metadata, "iv") : undefined;
  if (suite !== BLOB_CONTENT_KEY_WRAP_SUITE) {
    throw new Error("Blob content-key target uses an unknown suite");
  }
  if (typeof iv !== "string" || iv.length === 0) {
    throw new Error("Blob content-key target is missing an IV");
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
  writerProjection: DocumentWriterProjectionResponse,
): Record<string, unknown>[][] {
  return readCanonicalRecordPaths(
    writerProjection.authorizingContainerPaths.map(
      (projection) => projection.path,
    ),
    "Blob authorizing container paths",
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
      serializeKeyingCanonicalJson({
        domain: BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN,
        payload: {
          version: 1,
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
}): Record<string, KeyingCanonicalJson> {
  return {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "blob",
    objectId: input.blobId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
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
    serializeKeyingCanonicalJson({
      domain: BLOB_CONTENT_RECORD_KEY_INFO_DOMAIN,
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
    serializeKeyingCanonicalJson({
      domain: BLOB_CONTENT_RECORD_AAD_DOMAIN,
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
      salt: BLOB_CONTENT_RECORD_HKDF_SALT,
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
  contentKeyBundle: BlobContentKeyBundleRequest;
  organizationId: string;
}): Promise<BlobEncryptedBytes> {
  const contentRecordId = input.blobId;
  const { contentKeyEpoch, targetHash } = input.contentKeyBundle;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: input.organizationId,
    objectKind: "blob",
    objectId: input.blobId,
    contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
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
  const iv = createAesGcmIv();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
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
  const encryptedBytes = serializeKeyingCanonicalJson({
    format: BLOB_ENCRYPTED_BYTES_FORMAT,
    version: 1,
    blobId: input.blobId,
    byteLength: input.bytes.byteLength,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentKeyEpoch,
    contentRecordId,
    nonceDomainHash,
    metadataHash,
    targetHash,
    contentKeyBundle: readCanonicalJson(
      input.contentKeyBundle,
      "Blob encrypted bytes content-key bundle",
    ),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });

  return {
    encryptedBytes,
    metadataHash,
    sha256: await sha256Hex(encryptedBytes),
  };
}

function readContentKeyBundle(value: unknown): BlobContentKeyBundleRequest {
  if (!isPlainRecord(value)) {
    throw new Error("Blob content-key bundle must be an object");
  }
  const targets = Reflect.get(value, "targets");
  if (!Array.isArray(targets) || !targets.every(isPlainRecord)) {
    throw new Error("Blob content-key bundle targets are invalid");
  }

  return {
    contentKeyEpoch: readRecordNumber(
      value,
      "contentKeyEpoch",
      "Blob content-key bundle",
    ),
    targetHash: readRecordString(
      value,
      "targetHash",
      "Blob content-key bundle",
    ),
    targets: targets.map((target) => {
      const wrappingMetadata = Reflect.get(target, "wrappingMetadata");
      return {
        bindingId: readRecordString(target, "bindingId", "Blob target"),
        documentId: readRecordString(target, "documentId", "Blob target"),
        containerId: readRecordString(target, "containerId", "Blob target"),
        containerManifestHash: readRecordString(
          target,
          "containerManifestHash",
          "Blob target",
        ),
        containerKeyEpochId: readRecordString(
          target,
          "containerKeyEpochId",
          "Blob target",
        ),
        containerKeyEpoch: readRecordNumber(
          target,
          "containerKeyEpoch",
          "Blob target",
        ),
        wrappedKey: readRecordString(target, "wrappedKey", "Blob target"),
        wrappingMetadata: isPlainRecord(wrappingMetadata)
          ? wrappingMetadata
          : {},
      };
    }),
  };
}

function parseBlobEncryptedBytes(
  encryptedBytes: string,
): BlobEncryptedBytesRecord {
  let value: unknown;
  try {
    value = JSON.parse(encryptedBytes);
  } catch {
    throw new Error("Blob encrypted bytes are invalid JSON");
  }
  if (!isPlainRecord(value)) {
    throw new Error("Blob encrypted bytes must be an object");
  }
  assertOnlyRecordKeys(
    value,
    BLOB_ENCRYPTED_BYTES_KEYS,
    "Blob encrypted bytes",
  );
  if (
    readRecordString(value, "format", "Blob encrypted bytes") !==
    BLOB_ENCRYPTED_BYTES_FORMAT
  ) {
    throw new Error("Blob encrypted bytes format is invalid");
  }
  const version = readRecordNumber(value, "version", "Blob encrypted bytes");
  if (version !== 1) {
    throw new Error(
      `Blob encrypted bytes version ${version} is invalid; expected 1`,
    );
  }
  if (
    readRecordString(value, "encryptionSuite", "Blob encrypted bytes") !==
    CONTENT_RECORD_ENCRYPTION_SUITE
  ) {
    throw new Error("Blob encrypted bytes suite is invalid");
  }

  const iv = base64ToBytes(
    readRecordString(value, "iv", "Blob encrypted bytes"),
  );
  assertAesGcmIv(iv, "Blob encrypted bytes IV is invalid");

  return {
    blobId: readRecordString(value, "blobId", "Blob encrypted bytes"),
    byteLength: readRecordNumber(value, "byteLength", "Blob encrypted bytes"),
    ciphertext: base64ToBytes(
      readRecordString(value, "ciphertext", "Blob encrypted bytes"),
    ),
    contentKeyBundle: readContentKeyBundle(
      Reflect.get(value, "contentKeyBundle"),
    ),
    contentKeyEpoch: readRecordNumber(
      value,
      "contentKeyEpoch",
      "Blob encrypted bytes",
    ),
    contentRecordId: readRecordString(
      value,
      "contentRecordId",
      "Blob encrypted bytes",
    ),
    iv,
    metadataHash: readRecordString(
      value,
      "metadataHash",
      "Blob encrypted bytes",
    ),
    nonceDomainHash: readRecordString(
      value,
      "nonceDomainHash",
      "Blob encrypted bytes",
    ),
    targetHash: readRecordString(value, "targetHash", "Blob encrypted bytes"),
  };
}

async function unwrapBlobContentKey(input: {
  documentId: string;
  encrypted: BlobEncryptedBytesRecord;
  execSql?: ExecSql | undefined;
  expectedBindingId: string;
  resolveProjectionUserKey?: ProjectionUserKeyResolver | undefined;
  secretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<Uint8Array> {
  const keksByEpochId = await collectContainerKeks({
    execSql: input.execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
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
    throw new Error("Blob content-key bundle is missing attachment target");
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
        throw new Error("Blob content-key targets unwrap to conflicting keys");
      }
      continue;
    }
    contentKey = unwrapped;
  }

  if (!contentKey) {
    throw new Error("Blob content key could not be unwrapped");
  }
  return contentKey;
}

function contentKeyTargetReference(
  envelope: BlobContentKeyTargetEnvelopeRequest,
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
  bundle: BlobContentKeyBundleRequest,
): Promise<void> {
  const targetHash = await computeBlobContentKeyTargetHash(
    bundle.targets.map(contentKeyTargetReference),
  );
  if (targetHash !== bundle.targetHash) {
    throw new Error("Blob content-key target hash is not canonical");
  }
}

function normalizedBlobContentKeyBundle(
  bundle: BlobContentKeyBundleRequest,
): BlobContentKeyBundleRequest {
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
  contentKeyBundle: BlobContentKeyBundleRequest;
  manifestIdentity: DocumentManifestIdentity;
  response: BlobAttachmentBindResponse;
  targetHash: string;
  targets: readonly BlobContentKeyTarget[];
}): Promise<void> {
  // The bind route echoes key material that the client will persist and use for
  // future decrypts. Treat it as untrusted until it canonically matches the
  // request-derived targets and summaries.
  if (input.response.contentKeyBundle.blobId !== input.blobId) {
    throw new Error("Blob attachment bind response blob id mismatch");
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
      "Blob attachment bind response content-key bundle",
    ) !==
    serializeCanonical(
      normalizedBlobContentKeyBundle(input.contentKeyBundle),
      "Blob attachment bind request content-key bundle",
    )
  ) {
    throw new Error(
      "Blob attachment bind response content-key bundle mismatch",
    );
  }

  const responseTargets = sortBlobTargets(
    input.response.blobKekTargets.targets.map((target, index) =>
      readBlobKekTarget(
        target,
        `Blob attachment bind response KEK target[${index}]`,
      ),
    ),
  );
  const expectedTargets = sortBlobTargets(input.targets);
  if (
    serializeCanonical(
      responseTargets,
      "Blob attachment bind response KEK targets",
    ) !==
    serializeCanonical(
      expectedTargets,
      "Blob attachment bind request KEK targets",
    )
  ) {
    throw new Error("Blob attachment bind response KEK targets mismatch");
  }

  if (
    input.response.blobKekTargets.blobId !== input.blobId ||
    input.response.blobKekTargets.organizationId !==
      input.manifestIdentity.organizationId ||
    input.response.blobKekTargets.blobKeyTargetHash !== input.targetHash
  ) {
    throw new Error("Blob attachment bind response KEK summary mismatch");
  }
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.activeBindingIds,
    expected: [input.bindingId],
    message: "Blob attachment bind response active bindings mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.documentManifestHashes,
    expected: [input.manifestIdentity.manifestHash],
    message: "Blob attachment bind response document manifests mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.linkedContainerManifestHashes,
    expected: expectedTargets.map((target) => target.containerManifestHash),
    message: "Blob attachment bind response container manifests mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.linkedContainerKeyEpochIds,
    expected: expectedTargets.map((target) => target.containerKeyEpochId),
    message: "Blob attachment bind response container KEKs mismatch",
  });
}

export async function decryptDocumentAttachmentBlob({
  encryptedBytes,
  expectedBindingId,
  expectedBlobId,
  execSql,
  resolveProjectionUserKey,
  targetSecretKey,
  writerProjection,
}: DecryptDocumentAttachmentBlobInput): Promise<BlobBytes> {
  const encrypted = parseBlobEncryptedBytes(encryptedBytes);
  if (
    encrypted.blobId !== expectedBlobId ||
    encrypted.contentRecordId !== expectedBlobId
  ) {
    throw new Error("Blob encrypted bytes blob id mismatch");
  }
  if (
    encrypted.contentKeyEpoch !== encrypted.contentKeyBundle.contentKeyEpoch ||
    encrypted.targetHash !== encrypted.contentKeyBundle.targetHash
  ) {
    throw new Error("Blob encrypted bytes content-key bundle mismatch");
  }
  await assertBlobContentKeyBundleTargetHash(encrypted.contentKeyBundle);

  await assertDocumentWriterProjectionConsistent(writerProjection, {
    resolveProjectionUserKey,
  });
  const { documentId, organizationId } =
    readDocumentManifestIdentity(writerProjection);
  const expectedNonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId,
    objectKind: "blob",
    objectId: expectedBlobId,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: encrypted.contentRecordId,
  });
  if (encrypted.nonceDomainHash !== expectedNonceDomainHash) {
    throw new Error("Blob encrypted bytes nonce domain mismatch");
  }
  const expectedMetadataHash = await blobContentMetadataHash({
    blobId: expectedBlobId,
    byteLength: encrypted.byteLength,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    targetHash: encrypted.targetHash,
  });
  if (encrypted.metadataHash !== expectedMetadataHash) {
    throw new Error("Blob encrypted bytes metadata hash mismatch");
  }

  const contentKey = await unwrapBlobContentKey({
    documentId,
    encrypted,
    execSql,
    expectedBindingId,
    resolveProjectionUserKey,
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
        iv: asWebCryptoBytes(encrypted.iv),
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
    throw new Error("Blob decrypted byte length mismatch");
  }

  return decrypted as BlobBytes;
}

async function buildBlobAttachmentMaterial(input: {
  apiClient: BlobAttachmentApi;
  bindingId: string;
  blobId: string;
  bytes: BlobBytes;
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  documentId: string;
  execSql?: ExecSql | undefined;
  resolveProjectionUserKey?: ProjectionUserKeyResolver | undefined;
  targetSecretKey: Uint8Array;
}): Promise<BlobAttachmentMaterial | null> {
  const writerProjection = await input.apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  if (!writerProjection) {
    return null;
  }

  await assertDocumentWriterProjectionConsistent(writerProjection, {
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
  const manifestIdentity = readDocumentManifestIdentity(writerProjection);
  if (manifestIdentity.documentId !== input.documentId) {
    throw new Error("Blob attachment writer projection targets wrong document");
  }

  const targets = deriveBlobTargetsFromDocumentProjection({
    bindingId: input.bindingId,
    documentId: input.documentId,
    writerProjection,
  });
  const targetHash = await computeBlobContentKeyTargetHash(targets);
  const contentKeyBundle: BlobContentKeyBundleRequest = {
    contentKeyEpoch: input.contentKeyEpoch,
    targetHash,
    targets: await wrapBlobContentKey({
      contentKey: input.contentKey,
      execSql: input.execSql,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
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
    version: 1,
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
  author: DocumentCreateAuthor;
  bindingId: string;
  blobId: string;
  documentId: string;
  eventId: string;
  expectedBindingId: string | null;
  manifestIdentity: DocumentManifestIdentity;
  signedAt: string;
  slotId: string;
  targets: readonly BlobContentKeyTarget[];
}): Promise<{ body: AttachmentBindAccessEventBody; event: AccessEvent }> {
  const body: AttachmentBindAccessEventBody = {
    eventType: "attachment.bind",
    bindingId: input.bindingId,
    blobId: input.blobId,
    documentId: input.documentId,
    slotId: input.slotId,
    expectedBindingId: input.expectedBindingId,
    documentManifestHash: input.manifestIdentity.manifestHash,
  };
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
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
      readCanonicalJson(body, "Blob attachment bind body"),
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
  author: DocumentCreateAuthor;
  blobAccessManifestHash: string;
  blobId: string;
  contentKeyEpoch: number;
  encrypted: BlobEncryptedBytes;
  manifestIdentity: DocumentManifestIdentity;
  signedAt: string;
  targetHash: string;
}): Promise<{ writeHeader: WriteHeader; writeHeaderHash: string }> {
  const writeHeader = await signWriteHeader(
    {
      version: 1,
      organizationId: input.manifestIdentity.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      accessManifestHash: input.blobAccessManifestHash,
      contentKeyEpoch: input.contentKeyEpoch,
      targetHash: input.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: input.blobId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId: input.manifestIdentity.organizationId,
        objectKind: "blob",
        objectId: input.blobId,
        contentKeyEpoch: input.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
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
  contentKeyBundle: BlobContentKeyBundleRequest;
  documentId: string;
  manifestIdentity: DocumentManifestIdentity;
  response: BlobAttachmentBindResponse;
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
    throw new Error("Blob attachment bind response did not match request");
  }

  await assertBlobAttachmentBindResponseTargets(input);
}

function blobAttachmentStagedBlobRequest(
  stageId: string,
  writeHeader: WriteHeader,
): NonNullable<BlobAttachmentBindRequest["stagedBlob"]> {
  return {
    stageId,
    writeHeader: readCanonicalRecord(
      writeHeader,
      "Blob attachment write header",
    ),
  };
}

export async function uploadDocumentAttachment({
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
  resolveProjectionUserKey,
  signedAt = new Date().toISOString(),
  slotId,
  targetSecretKey,
}: UploadDocumentAttachmentInput): Promise<UploadDocumentAttachmentResult | null> {
  if (contentKey.byteLength !== 32) {
    throw new Error("Blob content key must be 32 bytes");
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
    resolveProjectionUserKey,
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

  const request: BlobAttachmentBindRequest = {
    event: readCanonicalRecord(event, "Blob attachment bind event"),
    body: readCanonicalRecord(body, "Blob attachment bind body"),
    documentManifest: material.writerProjection.documentManifest,
    authorizingContainerPaths: authorizingContainerPathRecords(
      material.writerProjection,
    ),
    contentKeyBundle: material.contentKeyBundle,
    stagedBlob: blobAttachmentStagedBlobRequest(stage.stageId, writeHeader),
  };
  const response = await apiClient.bindBlobAttachment(blobId, request);
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
