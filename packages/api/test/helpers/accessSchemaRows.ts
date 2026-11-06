import type { WriteHeader } from "@tearleads/crypto";

export const contentRecordEncryptionSuite =
  "aes-256-gcm-hkdf-sha256-record-key";

export function fixtureHash(label: string) {
  return `schema-test:${label}:${crypto.randomUUID()}`;
}

export function createWriteHeader(input: {
  readonly accessManifestHash: string;
  readonly contentKeyEpoch: number;
  readonly contentRecordId: string;
  readonly nonceDomainHash: string;
  readonly objectId: string;
  readonly objectKind: "blob" | "document";
  readonly organizationId: string;
  readonly targetHash: string;
  readonly writerUserId: string;
}): WriteHeader {
  return {
    dependencyManifestHashes: [],
    version: 1,
    organizationId: input.organizationId,
    objectKind: input.objectKind,
    objectId: input.objectId,
    accessManifestHash: input.accessManifestHash,
    contentKeyEpoch: input.contentKeyEpoch,
    targetHash: input.targetHash,
    encryptionSuite: contentRecordEncryptionSuite,
    contentRecordId: input.contentRecordId,
    nonceDomainHash: input.nonceDomainHash,
    metadataHash: fixtureHash(`${input.objectKind}:metadata`),
    ciphertextHash: fixtureHash(`${input.objectKind}:ciphertext`),
    writerUserId: input.writerUserId,
    writerDeviceId: "schema-test-device",
    writerKeyFingerprint: fixtureHash(`${input.objectKind}:writer-key`),
    signedAt: new Date().toISOString(),
    signature: fixtureHash(`${input.objectKind}:signature`),
  };
}

/** Ids of one container and its manifest that schema rows point at. */
export function createLinkedContainerIds() {
  return {
    containerId: crypto.randomUUID(),
    containerKeyEpochId: fixtureHash("container-key-epoch"),
    containerManifestHash: fixtureHash("container-manifest"),
    documentId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
    writerUserId: crypto.randomUUID(),
  };
}
