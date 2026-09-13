import {
  bytesToHex,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  computeContentRecordNonceDomainHash,
  makeVerifiedBlobKekTargets,
  verifyWriteHeader,
} from "@tearleads/crypto";
import type { BlobKekTargetsResponse } from "@tearleads/validators/response";
import type { BlobBytes } from "../../data/blobContracts";
import {
  blobContentMetadataHash,
  deriveBlobContentRecordKey,
} from "../../data/documents/blob/shared/crypto";
import { unwrapBlobContentKey } from "../../data/documents/blob/shared/projection";
import {
  parseBlobEncryptedBytes,
  readBlobKekTarget,
  readDocumentManifestIdentity,
  sortBlobTargets,
} from "../../data/documents/blob/shared/readers";
import { assertBlobContentKeyBundleTargetHash } from "../../data/documents/blob/shared/responses";
import type {
  BlobEncryptedBytesRecord,
  DecryptDocumentAttachmentBlobInput,
} from "../../data/documents/blob/shared/types";
import { importContentKeyMaterial } from "../../data/documents/shared/contentRecordKeys";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import {
  asWebCryptoBytes,
  readWriteHeader,
  uniqueSortedStrings,
} from "../../data/documents/shared/readers";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import type { DocumentWriterProjectionAuthorization } from "../../data/keyingProjectionVerification";
import {
  readRecordString,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import { resolveEventContainerPaths } from "../../data/keyingProjectionVerification/documentDependencyPaths";

import { assertAttachmentBindingVerified } from "./attachmentBindingVerification";
import { decryptBlobChunks } from "./blobChunkDecryption";
import { assertBlobWrapScopeVerified } from "./verifiedWrapScope";

async function assertBlobEncryptionMetadata(input: {
  readonly contentKeyBundle: DecryptDocumentAttachmentBlobInput["binding"]["contentKeyBundle"];
  readonly encrypted: BlobEncryptedBytesRecord;
  readonly expectedBlobId: string;
  readonly organizationId: string;
}): Promise<void> {
  const { contentKeyBundle, encrypted, expectedBlobId, organizationId } = input;
  if (
    encrypted.blobId !== expectedBlobId ||
    encrypted.contentRecordId !== expectedBlobId
  ) {
    throw new Error("Blob encrypted bytes blob id mismatch");
  }
  if (
    encrypted.contentKeyEpoch !== contentKeyBundle.contentKeyEpoch ||
    contentKeyBundle.blobId !== expectedBlobId
  ) {
    throw new Error("Blob encrypted bytes content-key bundle mismatch");
  }
  await assertBlobContentKeyBundleTargetHash(contentKeyBundle);

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
    chunkCount: encrypted.chunkCount,
    chunkSize: encrypted.chunkSize,
    contentKeyEpoch: encrypted.contentKeyEpoch,
  });
  if (encrypted.metadataHash !== expectedMetadataHash) {
    throw new Error("Blob encrypted bytes metadata hash mismatch");
  }
}

export type AttachmentBlobDecryptionInput = Omit<
  DecryptDocumentAttachmentBlobInput,
  "encryptedBytes"
> & {
  encrypted: BlobEncryptedBytesRecord;
};

/** Verifies metadata and authority; the caller must still authenticate ciphertext. */
export async function prepareDocumentAttachmentBlobDecryption({
  binding,
  encrypted,
  expectedDocumentId,
  expectedSlotId,
  execSql,
  resolveProjectionUserKey,
  targetSecretKey,
  writerProjection,
}: AttachmentBlobDecryptionInput): Promise<{
  contentKey: Uint8Array;
  recordKey: CryptoKey;
  organizationId: string;
}> {
  const requiredResolveProjectionUserKey = requireProjectionUserKeyResolver(
    resolveProjectionUserKey,
    "Document attachment blob decrypt",
  );
  const verificationOptions = projectionVerificationOptions({
    execSql,
    resolveProjectionUserKey: requiredResolveProjectionUserKey,
  });
  let documentAuthorization: DocumentWriterProjectionAuthorization | undefined;
  await assertDocumentWriterProjectionConsistent(writerProjection, {
    allowStaleContentKeyBundle: true,
    execSql,
    onVerifiedAuthorization: (authorization) => {
      documentAuthorization = authorization;
    },
    ...verificationOptions,
  });
  const { documentId, organizationId } =
    readDocumentManifestIdentity(writerProjection);
  await assertBlobEncryptionMetadata({
    contentKeyBundle: binding.contentKeyBundle,
    encrypted,
    expectedBlobId: binding.blobId,
    organizationId,
  });
  await assertAttachmentBindingVerified({
    authorization: documentAuthorization,
    binding,
    expectedDocumentId,
    expectedSlotId,
    resolveProjectionUserKey: requiredResolveProjectionUserKey,
  });
  await assertBlobWriteHeaderVerified({
    authorization: documentAuthorization,
    binding,
    encrypted,
    organizationId,
    resolveProjectionUserKey: requiredResolveProjectionUserKey,
  });

  if (!documentAuthorization)
    throw new Error("Blob document authorization is unavailable");
  assertBlobWrapScopeVerified({
    authorization: documentAuthorization,
    binding,
    documentId,
  });
  const contentKey = await unwrapBlobContentKey({
    contentKeyBundle: binding.contentKeyBundle,
    documentId,
    encrypted,
    execSql,
    expectedBindingId: binding.bindingId,
    secretKey: targetSecretKey,
    ...verificationOptions,
    writerProjection,
  });
  const contentKeyMaterial = await importContentKeyMaterial(contentKey);
  const recordKey = await deriveBlobContentRecordKey({
    blobId: binding.blobId,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    contentKeyMaterial,
    contentRecordId: encrypted.contentRecordId,
    organizationId,
    usage: "decrypt",
  });
  return { contentKey, recordKey, organizationId };
}

async function decryptDocumentAttachmentBlobWithKey(
  input: DecryptDocumentAttachmentBlobInput,
): Promise<{ bytes: BlobBytes; contentKey: Uint8Array }> {
  const encrypted = parseBlobEncryptedBytes(input.encryptedBytes);
  const context = await prepareDocumentAttachmentBlobDecryption({
    ...input,
    encrypted,
  });
  const header = readWriteHeader(
    input.binding.writeHeader,
    "Attachment blob write header",
  );
  const ciphertextHash = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        asWebCryptoBytes(input.encryptedBytes),
      ),
    ),
  );
  if (header.ciphertextHash !== ciphertextHash)
    throw new Error("Attachment blob write header does not match ciphertext");
  const bytes = await decryptBlobChunks({
    ...context,
    encrypted,
    expectedBlobId: input.binding.blobId,
  });
  return { bytes, contentKey: context.contentKey };
}

export async function decryptDocumentAttachmentBlob(
  input: DecryptDocumentAttachmentBlobInput,
): Promise<BlobBytes> {
  return (await decryptDocumentAttachmentBlobWithKey(input)).bytes;
}

function assertStringSetEquals(input: {
  readonly actual: readonly string[];
  readonly expected: readonly string[];
  readonly label: string;
}): void {
  const actual = uniqueSortedStrings(input.actual);
  const expected = uniqueSortedStrings(input.expected);
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${input.label} is inconsistent`);
  }
}

async function verifiedBlobKekTargetsForBinding(input: {
  readonly binding: DecryptDocumentAttachmentBlobInput["binding"];
  readonly requireBindingMembership: boolean;
  readonly projection: BlobKekTargetsResponse | undefined;
}) {
  const { binding, projection } = input;
  if (!projection) {
    throw new Error("Attachment binding lacks blob KEK verification material");
  }
  const targets = sortBlobTargets(
    projection.targets.map((target, index) =>
      readBlobKekTarget(target, `Attachment blob KEK target[${index}]`),
    ),
  );
  const targetHash = await computeBlobContentKeyTargetHash(targets);
  if (
    targetHash !== projection.blobKeyTargetHash ||
    projection.blobId !== binding.blobId
  ) {
    throw new Error("Attachment blob KEK target hash is inconsistent");
  }
  if (
    input.requireBindingMembership &&
    (!projection.activeBindingIds.includes(binding.bindingId) ||
      !targets.some(
        (target) =>
          target.bindingId === binding.bindingId &&
          target.documentId === attachmentBindingDocumentId(binding),
      ))
  ) {
    throw new Error("Attachment binding is absent from blob KEK targets");
  }
  assertStringSetEquals({
    actual: projection.linkedContainerManifestHashes,
    expected: targets.map((target) => target.containerManifestHash),
    label: "Attachment blob container manifests",
  });
  assertStringSetEquals({
    actual: projection.linkedContainerKeyEpochIds,
    expected: targets.map((target) => target.containerKeyEpochId),
    label: "Attachment blob container KEKs",
  });
  const accessManifestHash = await computeBlobAccessManifestHash({
    version: 1,
    blobId: projection.blobId,
    organizationId: projection.organizationId,
    activeBindingIds: projection.activeBindingIds,
    documentManifestHashes: projection.documentManifestHashes,
    linkedContainerManifestHashes: projection.linkedContainerManifestHashes,
    linkedContainerKeyEpochIds: projection.linkedContainerKeyEpochIds,
    blobKeyTargetHash: projection.blobKeyTargetHash,
  });
  if (accessManifestHash !== projection.blobAccessManifestHash) {
    throw new Error("Attachment blob access manifest hash is inconsistent");
  }
  return makeVerifiedBlobKekTargets({ ...projection, targets });
}

function attachmentBindingDocumentId(
  binding: DecryptDocumentAttachmentBlobInput["binding"],
): string {
  if (!binding.bindingEvent) {
    throw new Error("Attachment binding lacks a signed event");
  }
  return readRecordString(
    readCanonicalRecord(
      binding.bindingEvent.body,
      "Attachment binding event body",
    ),
    "documentId",
    "Attachment binding event body",
  );
}

async function assertBlobWriteHeaderVerified(input: {
  readonly authorization: DocumentWriterProjectionAuthorization | undefined;
  readonly binding: DecryptDocumentAttachmentBlobInput["binding"];
  readonly encrypted: BlobEncryptedBytesRecord;
  readonly organizationId: string;
  readonly resolveProjectionUserKey: ReturnType<
    typeof requireProjectionUserKeyResolver
  >;
}): Promise<void> {
  if (!input.authorization || !input.binding.writeHeader) {
    throw new Error("Attachment blob lacks verified write authority");
  }
  const header = readWriteHeader(
    input.binding.writeHeader,
    "Attachment blob write header",
  );
  const writer = await input.resolveProjectionUserKey(header.writerUserId);
  if (!writer) {
    throw new Error("Attachment blob writer identity is unavailable");
  }
  await verifiedBlobKekTargetsForBinding({
    binding: input.binding,
    projection: input.binding.blobKekTargets,
    requireBindingMembership: true,
  });
  const blobKekTargets = await verifiedBlobKekTargetsForBinding({
    binding: input.binding,
    projection: input.binding.writeAuthorization,
    // The signed binding proves which slot exposes the blob now. Writer
    // authorization describes the older target set committed when the bytes
    // were written, so a later valid binding need not appear in that set.
    requireBindingMembership: false,
  });
  if (
    header.metadataHash !== input.encrypted.metadataHash ||
    header.contentKeyEpoch !== input.encrypted.contentKeyEpoch ||
    header.contentRecordId !== input.encrypted.contentRecordId ||
    header.nonceDomainHash !== input.encrypted.nonceDomainHash
  ) {
    throw new Error("Attachment blob write header does not match ciphertext");
  }
  const verified = await verifyWriteHeader({
    authorizationMembership: "referenced",
    blobAuthorization: {
      authorizingContainerPaths: resolveEventContainerPaths({
        containerPathByManifestHash:
          input.authorization.containerPathByManifestHash,
        dependencyManifestHashes: header.dependencyManifestHashes,
      }).dependencyContainerPaths,
      blobKekTargets,
      principalPolicies: input.authorization.principalPolicies,
    },
    expectedAccessManifestHash: blobKekTargets.blobAccessManifestHash,
    expectedObject: {
      objectKind: "blob",
      objectId: input.binding.blobId,
      organizationId: input.organizationId,
    },
    expectedTargetHash: blobKekTargets.blobKeyTargetHash,
    header,
    writerPublicKey: writer.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
}
