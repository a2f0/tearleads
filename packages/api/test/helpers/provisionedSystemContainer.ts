import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  signWriteHeader,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument as createLoroDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import type {
  ContainerMutationRequest,
  DocumentCreateRequest,
  ProvisionedDocumentRequest,
  ProvisionedSystemContainerRequest,
} from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { toWireRecord } from "./registrationWire";

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function readHeaderString(
  header: Record<string, unknown>,
  key: string,
): string {
  const value = Reflect.get(header, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected write header ${key}`);
  }
  return value;
}

async function deriveOrganizationSystemSlot(
  namespace: string,
  organizationId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        namespace,
        organizationId,
        version: 1,
      }),
    ),
  );
  return `sys_v1_${toBase64Url(new Uint8Array(digest))}`;
}

export function deriveRosterProfileContainerSystemSlot(
  organizationId: string,
): Promise<string> {
  return deriveOrganizationSystemSlot(
    "tearleads.organization-roster-profiles",
    organizationId,
  );
}

export function deriveOrganizationMetadataContainerSystemSlot(
  organizationId: string,
): Promise<string> {
  return deriveOrganizationSystemSlot(
    "tearleads.organization-metadata",
    organizationId,
  );
}

export async function createProvisionedTrashFixture(input: {
  container: ContainerMutationRequest;
  containerProjection: ContainerWriterProjectionResponse;
  metadataDocument: DocumentCreateRequest;
  metadataDocumentId: string;
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<ProvisionedSystemContainerRequest> {
  return createProvisionedMetadataContainerFixture({
    container: input.container,
    containerProjection: input.containerProjection,
    initialName: "Trash",
    metadataDocument: input.metadataDocument,
    documentId: input.metadataDocumentId,
    fixtureLabel: "trash-metadata",
    organizationId: input.organizationId,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
    systemSlot: await deriveOrganizationSystemSlot(
      "tearleads.trash",
      input.organizationId,
    ),
    userId: input.userId,
  });
}

export async function createProvisionedMetadataContainerFixture(input: {
  container: ContainerMutationRequest;
  containerProjection: ContainerWriterProjectionResponse;
  documentId: string;
  fixtureLabel: string;
  initialName: string;
  metadataDocument: DocumentCreateRequest;
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  systemSlot: string;
  userId: string;
}): Promise<ProvisionedSystemContainerRequest> {
  const provisionedDocument = await createProvisionedDocumentFixture({
    containerProjection: input.containerProjection,
    document: input.metadataDocument,
    documentId: input.documentId,
    fixtureLabel: input.fixtureLabel,
    initialName: input.initialName,
    organizationId: input.organizationId,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
    userId: input.userId,
  });

  return {
    container: input.container,
    metadataDocument: input.metadataDocument,
    initialMetadataSync: provisionedDocument.initialSync,
    systemSlot: input.systemSlot,
  };
}

export async function createProvisionedDocumentFixture(input: {
  containerProjection: ContainerWriterProjectionResponse;
  document: DocumentCreateRequest;
  documentId: string;
  fixtureLabel: string;
  initialName: string;
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<ProvisionedDocumentRequest> {
  const updateId = crypto.randomUUID();
  const document = await createLoroDocument(
    `${input.fixtureLabel}-${updateId}`,
  );
  const partialStartVersionVector = encodeVersionVector(document);
  document.getText("name").update(input.initialName);
  const vectors = getUpdateVersionVectors(
    exportUpdatesSince(document, partialStartVersionVector),
  );
  const encryptedData = `encrypted-${input.fixtureLabel}:${updateId}`;
  const plaintextHash = `plaintext-hash:${updateId}`;
  const bundle = input.document.contentKeyBundle;
  const nonceDomain = {
    version: 1 as const,
    organizationId: input.organizationId,
    objectKind: "document" as const,
    objectId: input.documentId,
    contentKeyEpoch: bundle.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: updateId,
  };
  const writeHeader = await signWriteHeader(
    {
      ...nonceDomain,
      accessManifestHash: bundle.linkSetManifestHash,
      targetHash: bundle.targetHash,
      nonceDomainHash: await computeContentRecordNonceDomainHash(nonceDomain),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        documentId: input.documentId,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        plaintextHash,
        updateId,
      }),
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
      writerUserId: input.userId,
      writerDeviceId: input.signerDeviceId,
      writerKeyFingerprint: input.signerKeyFingerprint,
      signedAt: "2026-07-12T12:00:00.000Z",
    },
    input.signingPrivateKey,
  );

  return {
    ...input.document,
    initialSync: {
      authorizingContainerPathRefs: [
        input.containerProjection.path.map((entry) => ({
          containerId: String(Reflect.get(entry.state, "containerId")),
          manifestHash: entry.manifestHash,
        })),
      ],
      contentKeyBundle: bundle,
      contentKeyEpoch: bundle.contentKeyEpoch,
      expectedLinkSetManifestHash: bundle.linkSetManifestHash,
      expectedTargetHash: bundle.targetHash,
      localVersionVector: vectors.partialEndVersionVector,
      outgoingUpdates: [
        {
          encryptedData,
          id: updateId,
          partialStartVersionVector: vectors.partialStartVersionVector,
          partialEndVersionVector: vectors.partialEndVersionVector,
          plaintextHash,
          writeHeader: toWireRecord(
            writeHeader,
            `${input.fixtureLabel} initial header`,
          ),
        },
      ],
    },
  };
}

export async function createOptionalProvisionedDocumentFixture(input: {
  containerProjection: ContainerWriterProjectionResponse | undefined;
  document: DocumentCreateRequest | undefined;
  documentId: string | undefined;
  fixtureLabel: string;
  initialName: string;
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<ProvisionedDocumentRequest | undefined> {
  if (!input.containerProjection || !input.document || !input.documentId) {
    return undefined;
  }
  return createProvisionedDocumentFixture({
    ...input,
    containerProjection: input.containerProjection,
    document: input.document,
    documentId: input.documentId,
  });
}

/**
 * Re-signs a fixture seed as a dependency-bearing delta. The server cannot
 * inspect encrypted Loro bytes, so the signed non-empty start vector exercises
 * the provisioning-only genesis invariant rather than a signature mismatch.
 */
export async function makeProvisionedDocumentSeedDependencyBearing(
  request: ProvisionedDocumentRequest,
  signingPrivateKey: Uint8Array,
): Promise<void> {
  const update = request.initialSync.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected provisioned document update");
  }

  const document = await createLoroDocument(`dependent-seed-${update.id}`);
  document.getText("dependency").update("not included in seed");
  const partialStartVersionVector = encodeVersionVector(document);
  document.getText("name").update("dependency-bearing seed");
  const vectors = getUpdateVersionVectors(
    exportUpdatesSince(document, partialStartVersionVector),
  );
  const header = update.writeHeader;
  const nonceDomain = {
    version: 1 as const,
    organizationId: readHeaderString(header, "organizationId"),
    objectKind: "document" as const,
    objectId: readHeaderString(header, "objectId"),
    contentKeyEpoch: request.initialSync.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: readHeaderString(header, "contentRecordId"),
  };
  const writeHeader = await signWriteHeader(
    {
      ...nonceDomain,
      accessManifestHash: request.initialSync.expectedLinkSetManifestHash,
      targetHash: request.initialSync.expectedTargetHash,
      nonceDomainHash: await computeContentRecordNonceDomainHash(nonceDomain),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        documentId: nonceDomain.objectId,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        plaintextHash: update.plaintextHash,
        updateId: update.id,
      }),
      ciphertextHash: await computeDocumentContentRecordCiphertextHash(
        update.encryptedData,
      ),
      writerUserId: readHeaderString(header, "writerUserId"),
      writerDeviceId: readHeaderString(header, "writerDeviceId"),
      writerKeyFingerprint: readHeaderString(header, "writerKeyFingerprint"),
      signedAt: readHeaderString(header, "signedAt"),
    },
    signingPrivateKey,
  );

  request.initialSync.localVersionVector = vectors.partialEndVersionVector;
  request.initialSync.outgoingUpdates[0] = {
    ...update,
    partialStartVersionVector: vectors.partialStartVersionVector,
    partialEndVersionVector: vectors.partialEndVersionVector,
    writeHeader: toWireRecord(writeHeader, "dependency-bearing seed header"),
  };
}
