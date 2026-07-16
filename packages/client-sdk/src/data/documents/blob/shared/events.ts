import {
  type AccessEvent,
  type AttachmentBindAccessEventBody,
  type AttachmentDetachAccessEventBody,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventBodyHash,
  computeContentRecordNonceDomainHash,
  computeWriteHeaderHash,
  signAccessEvent,
  signWriteHeader,
  type UnsignedAccessEvent,
  type WriteHeader,
} from "@tearleads/crypto";
import { readCanonicalJson } from "../../../keyingCanonicalJson";
import { uniqueSortedStrings } from "../../shared/readers";
import type { DocumentCreateAuthor } from "../../shared/types";
import type {
  BlobContentKeyTarget,
  BlobEncryptionPlan,
  DocumentManifestIdentity,
} from "./types";

export async function signBlobAttachmentEvent(input: {
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

export async function signBlobAttachmentDetachEvent(input: {
  author: DocumentCreateAuthor;
  bindingId: string;
  blobId: string;
  documentId: string;
  eventId: string;
  manifestIdentity: DocumentManifestIdentity;
  signedAt: string;
  slotId: string;
  targets: readonly BlobContentKeyTarget[];
}): Promise<{ body: AttachmentDetachAccessEventBody; event: AccessEvent }> {
  const body: AttachmentDetachAccessEventBody = {
    eventType: "attachment.detach",
    bindingId: input.bindingId,
    blobId: input.blobId,
    documentId: input.documentId,
    slotId: input.slotId,
    documentManifestHash: input.manifestIdentity.manifestHash,
  };
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId: input.eventId,
    eventType: "attachment.detach",
    objectKind: "blob",
    objectId: input.blobId,
    organizationId: input.manifestIdentity.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: uniqueSortedStrings([
      input.manifestIdentity.manifestHash,
      ...input.targets.map((target) => target.containerManifestHash),
    ]),
    bodyHash: await computeAccessEventBodyHash(
      readCanonicalJson(body, "Blob attachment detach body"),
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

export async function signBlobAttachmentWriteHeader(input: {
  author: DocumentCreateAuthor;
  blobAccessManifestHash: string;
  blobId: string;
  contentKeyEpoch: number;
  encrypted: BlobEncryptionPlan;
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
