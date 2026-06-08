import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { toFingerprint } from "../fingerprint";
import { sign } from "../signing/sign";
import { verify } from "../signing/verify";
import { computeKeyingDomainHash, encodeDomainPayload } from "./canonical";
import {
  assertExactKeys,
  normalizeContentObjectKind,
  normalizeContentRecordEncryptionSuite,
  readContentRecordId,
  readHashString,
  readPositiveInteger,
  readSignedAt,
  readString,
  readVersion,
  runVerifier,
  throwVerification,
} from "./shared";
import type {
  ContentRecordNonceDomain,
  KeyingCanonicalPayload,
  KeyingVerificationResult,
  UnsignedWriteHeader,
  VerifiedWriteHeader,
  VerifyWriteHeaderInput,
  WriteHeader,
} from "./types";
import { makeVerifiedWriteHeader } from "./types";
import { assertWriteHeaderAuthorizations } from "./writeHeaderAuthorization";

function normalizeUnsignedWriteHeader(value: unknown): UnsignedWriteHeader {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "ciphertextHash",
      "contentRecordId",
      "contentKeyEpoch",
      "encryptionSuite",
      "metadataHash",
      "nonceDomainHash",
      "objectId",
      "objectKind",
      "organizationId",
      "signedAt",
      "targetHash",
      "version",
      "writerDeviceId",
      "writerKeyFingerprint",
      "writerUserId",
    ],
    "write header",
  );

  return {
    version: readVersion(record, "write header"),
    organizationId: readString(record, "organizationId", "write header"),
    objectKind: normalizeContentObjectKind(record.objectKind, "write header"),
    objectId: readString(record, "objectId", "write header"),
    accessManifestHash: readHashString(
      record,
      "accessManifestHash",
      "write header",
    ),
    contentKeyEpoch: readPositiveInteger(
      record,
      "contentKeyEpoch",
      "write header",
    ),
    targetHash: readHashString(record, "targetHash", "write header"),
    encryptionSuite: normalizeContentRecordEncryptionSuite(
      record.encryptionSuite,
      "write header",
    ),
    contentRecordId: readContentRecordId(
      record,
      "contentRecordId",
      "write header",
    ),
    nonceDomainHash: readHashString(record, "nonceDomainHash", "write header"),
    metadataHash: readHashString(record, "metadataHash", "write header"),
    ciphertextHash: readHashString(record, "ciphertextHash", "write header"),
    writerUserId: readString(record, "writerUserId", "write header"),
    writerDeviceId: readString(record, "writerDeviceId", "write header"),
    writerKeyFingerprint: readHashString(
      record,
      "writerKeyFingerprint",
      "write header",
    ),
    signedAt: readSignedAt(record, "signedAt", "write header"),
  };
}

function normalizeWriteHeader(value: unknown): WriteHeader {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "ciphertextHash",
      "contentRecordId",
      "contentKeyEpoch",
      "encryptionSuite",
      "metadataHash",
      "nonceDomainHash",
      "objectId",
      "objectKind",
      "organizationId",
      "signature",
      "signedAt",
      "targetHash",
      "version",
      "writerDeviceId",
      "writerKeyFingerprint",
      "writerUserId",
    ],
    "write header",
  );
  const unsignedHeader = normalizeUnsignedWriteHeader({
    version: record.version,
    organizationId: record.organizationId,
    objectKind: record.objectKind,
    objectId: record.objectId,
    accessManifestHash: record.accessManifestHash,
    contentKeyEpoch: record.contentKeyEpoch,
    targetHash: record.targetHash,
    encryptionSuite: record.encryptionSuite,
    contentRecordId: record.contentRecordId,
    nonceDomainHash: record.nonceDomainHash,
    metadataHash: record.metadataHash,
    ciphertextHash: record.ciphertextHash,
    writerUserId: record.writerUserId,
    writerDeviceId: record.writerDeviceId,
    writerKeyFingerprint: record.writerKeyFingerprint,
    signedAt: record.signedAt,
  });

  return {
    ...unsignedHeader,
    signature: readString(record, "signature", "write header"),
  };
}

function unsignedWriteHeaderPayload(
  header: UnsignedWriteHeader,
): KeyingCanonicalPayload<UnsignedWriteHeader> {
  return normalizeUnsignedWriteHeader(header);
}

function contentRecordNonceDomainFromHeader(
  header: UnsignedWriteHeader,
): ContentRecordNonceDomain {
  const normalizedHeader = normalizeUnsignedWriteHeader(header);

  return {
    version: 1,
    organizationId: normalizedHeader.organizationId,
    objectKind: normalizedHeader.objectKind,
    objectId: normalizedHeader.objectId,
    contentKeyEpoch: normalizedHeader.contentKeyEpoch,
    encryptionSuite: normalizedHeader.encryptionSuite,
    contentRecordId: normalizedHeader.contentRecordId,
  };
}

function normalizeContentRecordNonceDomain(
  value: unknown,
): ContentRecordNonceDomain {
  const record = assertExactKeys(
    value,
    [
      "contentKeyEpoch",
      "contentRecordId",
      "encryptionSuite",
      "objectId",
      "objectKind",
      "organizationId",
      "version",
    ],
    "content record nonce domain",
  );

  return {
    version: readVersion(record, "content record nonce domain"),
    organizationId: readString(
      record,
      "organizationId",
      "content record nonce domain",
    ),
    objectKind: normalizeContentObjectKind(
      record.objectKind,
      "content record nonce domain",
    ),
    objectId: readString(record, "objectId", "content record nonce domain"),
    contentKeyEpoch: readPositiveInteger(
      record,
      "contentKeyEpoch",
      "content record nonce domain",
    ),
    encryptionSuite: normalizeContentRecordEncryptionSuite(
      record.encryptionSuite,
      "content record nonce domain",
    ),
    contentRecordId: readContentRecordId(
      record,
      "contentRecordId",
      "content record nonce domain",
    ),
  };
}

export async function computeContentRecordNonceDomainHash(
  domain: ContentRecordNonceDomain,
): Promise<string> {
  const payload: KeyingCanonicalPayload<ContentRecordNonceDomain> =
    normalizeContentRecordNonceDomain(domain);

  return computeKeyingDomainHash(
    "tearleads.keying.content-record-nonce-domain",
    payload,
  );
}

async function assertWriteHeaderNonceDomainHash(
  header: UnsignedWriteHeader,
): Promise<ContentRecordNonceDomain> {
  const nonceDomain = contentRecordNonceDomainFromHeader(header);
  const nonceDomainHash =
    await computeContentRecordNonceDomainHash(nonceDomain);

  if (nonceDomainHash !== header.nonceDomainHash) {
    throwVerification(
      "hash_mismatch",
      "write header nonce domain hash does not match derived content record domain",
    );
  }

  return nonceDomain;
}

function writeHeaderSigningBytes(header: UnsignedWriteHeader): Uint8Array {
  return encodeDomainPayload(
    "tearleads.keying.write-header-signing",
    unsignedWriteHeaderPayload(header),
  );
}

function toUnsignedWriteHeader(header: WriteHeader): UnsignedWriteHeader {
  return {
    version: header.version,
    organizationId: header.organizationId,
    objectKind: header.objectKind,
    objectId: header.objectId,
    accessManifestHash: header.accessManifestHash,
    contentKeyEpoch: header.contentKeyEpoch,
    targetHash: header.targetHash,
    encryptionSuite: header.encryptionSuite,
    contentRecordId: header.contentRecordId,
    nonceDomainHash: header.nonceDomainHash,
    metadataHash: header.metadataHash,
    ciphertextHash: header.ciphertextHash,
    writerUserId: header.writerUserId,
    writerDeviceId: header.writerDeviceId,
    writerKeyFingerprint: header.writerKeyFingerprint,
    signedAt: header.signedAt,
  };
}

export async function signWriteHeader(
  header: UnsignedWriteHeader,
  signingPrivateKey: Uint8Array,
): Promise<WriteHeader> {
  const normalizedHeader = normalizeUnsignedWriteHeader(header);
  await assertWriteHeaderNonceDomainHash(normalizedHeader);
  const signature = sign(
    writeHeaderSigningBytes(normalizedHeader),
    signingPrivateKey,
  );

  return {
    ...normalizedHeader,
    signature: bytesToBase64(signature),
  };
}

export async function computeWriteHeaderHash(
  header: WriteHeader,
): Promise<string> {
  const payload: KeyingCanonicalPayload<WriteHeader> =
    normalizeWriteHeader(header);

  return computeKeyingDomainHash("tearleads.keying.write-header", payload);
}

export async function verifyWriteHeader({
  blobAuthorization,
  documentAuthorization,
  expectedAccessManifestHash,
  expectedObject,
  expectedTargetHash,
  header,
  writerPublicKey,
}: VerifyWriteHeaderInput): Promise<
  KeyingVerificationResult<VerifiedWriteHeader>
> {
  return runVerifier(async () => {
    const normalizedHeader = normalizeWriteHeader(header);
    const nonceDomain = await assertWriteHeaderNonceDomainHash(
      toUnsignedWriteHeader(normalizedHeader),
    );
    const writerKeyFingerprint = await toFingerprint(writerPublicKey);

    if (writerKeyFingerprint !== normalizedHeader.writerKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "write header writer fingerprint does not match writer public key",
      );
    }

    if (
      expectedAccessManifestHash !== undefined &&
      expectedAccessManifestHash !== normalizedHeader.accessManifestHash
    ) {
      throwVerification(
        "hash_mismatch",
        "write header access manifest hash does not match expected hash",
      );
    }

    if (
      expectedTargetHash !== undefined &&
      expectedTargetHash !== normalizedHeader.targetHash
    ) {
      throwVerification(
        "hash_mismatch",
        "write header target hash does not match expected hash",
      );
    }

    if (
      expectedObject &&
      (expectedObject.objectKind !== normalizedHeader.objectKind ||
        expectedObject.objectId !== normalizedHeader.objectId ||
        (expectedObject.organizationId !== undefined &&
          expectedObject.organizationId !== normalizedHeader.organizationId))
    ) {
      throwVerification(
        "object_mismatch",
        "write header object does not match expected object",
      );
    }

    assertWriteHeaderAuthorizations({
      blobAuthorization,
      documentAuthorization,
      header: normalizedHeader,
    });

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedHeader.signature);
    } catch {
      throwVerification("signature_mismatch", "write header signature invalid");
    }

    if (
      !verify(
        signature,
        writeHeaderSigningBytes(toUnsignedWriteHeader(normalizedHeader)),
        writerPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "write header signature verification failed",
      );
    }

    return makeVerifiedWriteHeader({
      header: normalizedHeader,
      headerHash: await computeWriteHeaderHash(normalizedHeader),
      nonceDomain,
      nonceDomainHash: normalizedHeader.nonceDomainHash,
    });
  });
}
