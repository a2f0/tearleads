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

async function deriveTrashSystemSlot(organizationId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        namespace: "tearleads.trash",
        organizationId,
        version: 1,
      }),
    ),
  );
  return `sys_v1_${toBase64Url(new Uint8Array(digest))}`;
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
  const updateId = crypto.randomUUID();
  const document = await createLoroDocument(`trash-metadata-${updateId}`);
  const partialStartVersionVector = encodeVersionVector(document);
  document.getText("name").update("Trash");
  const vectors = getUpdateVersionVectors(
    exportUpdatesSince(document, partialStartVersionVector),
  );
  const encryptedData = `encrypted-trash-metadata:${updateId}`;
  const bundle = input.metadataDocument.contentKeyBundle;
  const nonceDomain = {
    version: 1 as const,
    organizationId: input.organizationId,
    objectKind: "document" as const,
    objectId: input.metadataDocumentId,
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
        documentId: input.metadataDocumentId,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
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
    systemSlot: await deriveTrashSystemSlot(input.organizationId),
    container: input.container,
    metadataDocument: input.metadataDocument,
    initialMetadataSync: {
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
          writeHeader: toWireRecord(writeHeader, "initial metadata header"),
        },
      ],
    },
  };
}
