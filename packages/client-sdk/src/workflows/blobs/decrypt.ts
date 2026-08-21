import {
  bytesToHex,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  computeContentRecordNonceDomainHash,
  makeVerifiedBlobKekTargets,
  verifyAttachmentBindingEvent,
  verifyWriteHeader,
} from "@symcrypt/crypto";
import type { BlobKekTargetsResponse } from "@symcrypt/validators/response";
import type { BlobBytes } from "../../data/blobContracts";
import { deriveBlobChunkIv } from "../../data/documents/blob/shared/blobEnvelopeV2";
import {
  blobContentMetadataHash,
  contentRecordAdditionalDataBytes,
  deriveBlobContentRecordKey,
} from "../../data/documents/blob/shared/crypto";
import { unwrapBlobContentKey } from "../../data/documents/blob/shared/projection";
import {
  contentKeyTargetReference,
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
  serializeCanonical,
  uniqueSortedStrings,
} from "../../data/documents/shared/readers";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../data/keyingCanonicalJson";
import type { DocumentWriterProjectionAuthorization } from "../../data/keyingProjectionVerification";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import {
  readAccessEvent,
  readRecordString,
  readRequiredRecordValue,
} from "../../data/keyingProjectionVerification/readers";

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

async function decryptBlobChunks(input: {
  readonly encrypted: BlobEncryptedBytesRecord;
  readonly expectedBlobId: string;
  readonly organizationId: string;
  readonly recordKey: CryptoKey;
}): Promise<BlobBytes> {
  const { encrypted, expectedBlobId, organizationId, recordKey } = input;
  const decrypted = new Uint8Array(encrypted.byteLength);
  for (const chunk of encrypted.chunks) {
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: deriveBlobChunkIv(encrypted.iv, chunk.index),
          additionalData: contentRecordAdditionalDataBytes({
            blobId: expectedBlobId,
            chunkCount: encrypted.chunkCount,
            chunkIndex: chunk.index,
            chunkPlaintextByteLength: chunk.plaintextByteLength,
            chunkSize: encrypted.chunkSize,
            contentKeyEpoch: encrypted.contentKeyEpoch,
            contentRecordId: encrypted.contentRecordId,
            metadataHash: encrypted.metadataHash,
            nonceDomainHash: encrypted.nonceDomainHash,
            organizationId,
            plaintextByteLength: encrypted.byteLength,
          }),
        },
        recordKey,
        asWebCryptoBytes(chunk.ciphertext),
      ),
    );
    if (plaintext.byteLength !== chunk.plaintextByteLength) {
      throw new Error("Blob decrypted chunk byte length mismatch");
    }
    decrypted.set(plaintext, chunk.index * encrypted.chunkSize);
  }
  return asWebCryptoBytes(decrypted);
}

export async function decryptDocumentAttachmentBlob({
  binding,
  encryptedBytes,
  expectedDocumentId,
  expectedSlotId,
  execSql,
  resolveProjectionUserKey,
  targetSecretKey,
  writerProjection,
}: DecryptDocumentAttachmentBlobInput): Promise<BlobBytes> {
  const requiredResolveProjectionUserKey = requireProjectionUserKeyResolver(
    resolveProjectionUserKey,
    "Document attachment blob decrypt",
  );
  const verificationOptions = projectionVerificationOptions({
    execSql,
    resolveProjectionUserKey: requiredResolveProjectionUserKey,
  });
  const encrypted = parseBlobEncryptedBytes(encryptedBytes);
  let documentAuthorization: DocumentWriterProjectionAuthorization | undefined;
  await assertDocumentWriterProjectionConsistent(writerProjection, {
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
    encryptedBytes,
    organizationId,
    resolveProjectionUserKey: requiredResolveProjectionUserKey,
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
  return decryptBlobChunks({
    encrypted,
    expectedBlobId: binding.blobId,
    organizationId,
    recordKey,
  });
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
  readonly requireCurrentBundleMatch: boolean;
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
  const bundleTargets = input.requireCurrentBundleMatch
    ? sortBlobTargets(
        binding.contentKeyBundle.targets.map(contentKeyTargetReference),
      )
    : null;
  if (
    bundleTargets &&
    serializeCanonical(targets, "Attachment blob KEK targets") !==
      serializeCanonical(bundleTargets, "Attachment content-key targets")
  ) {
    throw new Error("Attachment blob KEK targets differ from wrapped targets");
  }
  const targetHash = await computeBlobContentKeyTargetHash(targets);
  if (
    (input.requireCurrentBundleMatch &&
      targetHash !== binding.contentKeyBundle.targetHash) ||
    targetHash !== projection.blobKeyTargetHash ||
    projection.blobId !== binding.blobId
  ) {
    throw new Error("Attachment blob KEK target hash is inconsistent");
  }
  if (
    input.requireBindingMembership &&
    (!projection.activeBindingIds.includes(binding.bindingId) ||
      !projection.documentManifestHashes.includes(
        binding.documentManifestHash ?? "",
      ) ||
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
  readonly encryptedBytes: Uint8Array;
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
    requireCurrentBundleMatch: true,
  });
  const blobKekTargets = await verifiedBlobKekTargetsForBinding({
    binding: input.binding,
    projection:
      input.binding.writeAuthorization ?? input.binding.blobKekTargets,
    // The signed binding proves which slot exposes the blob now. Writer
    // authorization describes the older target set committed when the bytes
    // were written, so a later valid binding need not appear in that set.
    requireBindingMembership: false,
    requireCurrentBundleMatch: false,
  });
  const ciphertextHash = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        asWebCryptoBytes(input.encryptedBytes),
      ),
    ),
  );
  if (
    header.ciphertextHash !== ciphertextHash ||
    header.metadataHash !== input.encrypted.metadataHash ||
    header.contentKeyEpoch !== input.encrypted.contentKeyEpoch ||
    header.contentRecordId !== input.encrypted.contentRecordId ||
    header.nonceDomainHash !== input.encrypted.nonceDomainHash
  ) {
    throw new Error("Attachment blob write header does not match ciphertext");
  }
  const verified = await verifyWriteHeader({
    blobAuthorization: {
      authorizingContainerPaths: [
        ...input.authorization.containerPathByManifestHash.values(),
      ],
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

async function assertAttachmentBindingVerified(input: {
  readonly authorization: DocumentWriterProjectionAuthorization | undefined;
  readonly binding: DecryptDocumentAttachmentBlobInput["binding"];
  readonly expectedDocumentId: string;
  readonly expectedSlotId: string;
  readonly resolveProjectionUserKey: ReturnType<
    typeof requireProjectionUserKeyResolver
  >;
}): Promise<void> {
  if (!input.authorization) {
    throw new Error("Attachment binding lacks verified document authority");
  }
  if (
    !input.binding.bindingEvent ||
    !input.binding.documentManifestHash ||
    input.binding.previousBindingId === undefined
  ) {
    throw new Error("Attachment binding lacks signed verification material");
  }
  const eventBundle = readCanonicalRecord(
    input.binding.bindingEvent,
    "Attachment binding event bundle",
  );
  const event = readAccessEvent(
    readRequiredRecordValue(
      eventBundle,
      "event",
      "Attachment binding event bundle",
    ),
    "Attachment binding event",
  );
  const signer = await input.resolveProjectionUserKey(event.signerUserId);
  if (!signer) {
    throw new Error("Attachment binding signer identity is unavailable");
  }
  const documentManifest = input.authorization.documentManifestByHash.get(
    input.binding.documentManifestHash,
  );
  if (!documentManifest) {
    throw new Error("Attachment binding document manifest is unverified");
  }
  const verified = await verifyAttachmentBindingEvent({
    authorizingContainerPaths: [
      ...input.authorization.containerPathByManifestHash.values(),
    ],
    body: readCanonicalJson(
      readRequiredRecordValue(
        eventBundle,
        "body",
        "Attachment binding event bundle",
      ),
      "Attachment binding event body",
    ),
    documentManifest,
    event,
    expectedBindingId: input.binding.bindingId,
    expectedBlobId: input.binding.blobId,
    expectedDocumentId: input.expectedDocumentId,
    expectedDocumentManifestHash: input.binding.documentManifestHash,
    expectedPreviousBindingId: input.binding.previousBindingId,
    principalPolicies: input.authorization.principalPolicies,
    signerPublicKey: signer.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  if (
    verified.value.slotId !== input.expectedSlotId ||
    readRecordString(
      eventBundle,
      "eventHash",
      "Attachment binding event bundle",
    ) !== verified.value.event.eventHash
  ) {
    throw new Error("Attachment binding slot or event hash is inconsistent");
  }
}
