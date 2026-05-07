import { bytesToHex } from "@tearleads/crypto";
import type {
  BlobAttachmentSummary,
  BlobResponse,
  DocumentWriterProjectionResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../../data/blobs";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { decryptDocumentAttachmentBlob } from "./decrypt";

interface DocumentAttachmentHydrationApi {
  getBlob(blobId: string): Promise<BlobResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  listDocumentAttachments(
    documentId: string,
  ): Promise<ListDocumentAttachmentsResponse | null>;
}

interface HydratedDocumentAttachmentBlob {
  attachment: DocumentAttachment;
  binding: BlobAttachmentSummary;
  bytes: BlobBytes;
  storageKey: string;
}

interface DocumentAttachmentHydrationContext {
  apiClient: DocumentAttachmentHydrationApi;
  documentId: string;
  execSql?: ExecSql | undefined;
  log?: ((message: string) => void) | undefined;
  logPrefix?: string | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  targetSecretKey: Uint8Array;
}

const TEXT_ENCODER = new TextEncoder();

async function hasExpectedBlobSha256(blob: BlobResponse): Promise<boolean> {
  const blobDigest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      TEXT_ENCODER.encode(blob.encryptedBytes),
    ),
  );

  return bytesToHex(blobDigest) === blob.sha256;
}

async function hydrateDocumentAttachmentBlob(
  input: DocumentAttachmentHydrationContext & {
    attachment: DocumentAttachment;
    binding: BlobAttachmentSummary;
  },
): Promise<HydratedDocumentAttachmentBlob | null> {
  const { apiClient, binding, documentId, log } = input;
  const logPrefix = input.logPrefix ?? "Documents";
  const blob = await apiClient.getBlob(binding.blobId);
  if (!blob) {
    return null;
  }

  if (!(await hasExpectedBlobSha256(blob))) {
    log?.(
      `${logPrefix}: blob ${binding.blobId} sha256 mismatch during hydration.`,
    );
    return null;
  }

  const writerProjection =
    await apiClient.getDocumentWriterProjection(documentId);
  if (!writerProjection) {
    log?.(
      `${logPrefix}: cannot hydrate blob ${binding.blobId} without a writer projection.`,
    );
    return null;
  }

  const bytes = await decryptDocumentAttachmentBlob({
    encryptedBytes: blob.encryptedBytes,
    expectedBindingId: binding.bindingId,
    expectedBlobId: binding.blobId,
    execSql: input.execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: input.targetSecretKey,
    writerProjection,
  });

  return {
    attachment: input.attachment,
    binding,
    bytes,
    storageKey: `blob-${binding.blobId}`,
  };
}

export async function hydrateDocumentAttachmentBlobs(
  input: DocumentAttachmentHydrationContext & {
    attachments: ReadonlyArray<DocumentAttachment>;
  },
): Promise<HydratedDocumentAttachmentBlob[] | null> {
  const attachmentBindings = await input.apiClient.listDocumentAttachments(
    input.documentId,
  );
  if (!attachmentBindings) {
    return null;
  }

  const bindingBySlotId = new Map(
    attachmentBindings.map((binding) => [binding.slotId, binding]),
  );
  const hydratedBlobs: HydratedDocumentAttachmentBlob[] = [];

  for (const attachment of input.attachments) {
    const binding = bindingBySlotId.get(attachment.slotId);
    if (!binding) {
      continue;
    }

    const hydrated = await hydrateDocumentAttachmentBlob({
      ...input,
      attachment,
      binding,
    });
    if (hydrated) {
      hydratedBlobs.push(hydrated);
    }
  }

  return hydratedBlobs;
}
