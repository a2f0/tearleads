import type { BlobBytesResponse } from "@tearleads/api-client";
import { bytesToHex } from "@tearleads/crypto";
import type {
  BlobAttachmentSummary,
  DocumentWriterProjectionResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../../data/blobContracts";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { decryptDocumentAttachmentBlob } from "./decrypt";

interface DocumentAttachmentHydrationApi {
  getBlobBytes(blobId: string): Promise<BlobBytesResponse | null>;
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

export type DocumentAttachmentHydrationRuntime = {
  apiClient: DocumentAttachmentHydrationApi;
  execSql?: ExecSql | undefined;
  log: (message: string) => void;
};

interface DocumentAttachmentHydrationContext {
  apiClient: DocumentAttachmentHydrationApi;
  documentId: string;
  execSql?: ExecSql | undefined;
  log?: ((message: string) => void) | undefined;
  logPrefix?: string | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  targetSecretKey: Uint8Array;
}

interface DocumentAttachmentHydrationTarget {
  attachment: DocumentAttachment;
  binding: BlobAttachmentSummary;
}

interface LoadedDocumentAttachmentBlob
  extends DocumentAttachmentHydrationTarget {
  encryptedBytes: string;
}

const TEXT_DECODER = new TextDecoder();

function concatenateChunks(
  chunks: ReadonlyArray<Uint8Array>,
  byteLength: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

async function readBlobStreamBytes(
  blob: BlobBytesResponse,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = blob.encryptedBytes.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    byteLength += value.byteLength;
  }

  return concatenateChunks(chunks, byteLength);
}

async function hasExpectedBlobSha256(
  blob: BlobBytesResponse,
  encryptedBytes: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const blobDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encryptedBytes),
  );

  return bytesToHex(blobDigest) === blob.sha256;
}

function isLoadedDocumentAttachmentBlob(
  loaded: LoadedDocumentAttachmentBlob | null,
): loaded is LoadedDocumentAttachmentBlob {
  return loaded !== null;
}

async function loadDocumentAttachmentBlob(
  input: DocumentAttachmentHydrationContext & {
    attachment: DocumentAttachment;
    binding: BlobAttachmentSummary;
  },
): Promise<LoadedDocumentAttachmentBlob | null> {
  const { apiClient, binding, log } = input;
  const logPrefix = input.logPrefix ?? "Documents";
  const blob = await apiClient.getBlobBytes(binding.blobId);
  if (!blob) {
    return null;
  }

  let encryptedBytes: Uint8Array<ArrayBuffer>;
  try {
    encryptedBytes = await readBlobStreamBytes(blob);
  } catch (error) {
    log?.(
      `${logPrefix}: blob ${binding.blobId} failed to stream during hydration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  if (encryptedBytes.byteLength !== blob.byteLength) {
    log?.(
      `${logPrefix}: blob ${binding.blobId} byte length mismatch during hydration.`,
    );
    return null;
  }

  if (!(await hasExpectedBlobSha256(blob, encryptedBytes))) {
    log?.(
      `${logPrefix}: blob ${binding.blobId} sha256 mismatch during hydration.`,
    );
    return null;
  }

  return {
    attachment: input.attachment,
    binding,
    encryptedBytes: TEXT_DECODER.decode(encryptedBytes),
  };
}

async function decryptLoadedDocumentAttachmentBlob(
  input: DocumentAttachmentHydrationContext & {
    loaded: LoadedDocumentAttachmentBlob;
    writerProjection: DocumentWriterProjectionResponse;
  },
): Promise<HydratedDocumentAttachmentBlob> {
  const bytes = await decryptDocumentAttachmentBlob({
    encryptedBytes: input.loaded.encryptedBytes,
    expectedBindingId: input.loaded.binding.bindingId,
    expectedBlobId: input.loaded.binding.blobId,
    execSql: input.execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
  });

  return {
    attachment: input.loaded.attachment,
    binding: input.loaded.binding,
    bytes,
    storageKey: `blob-${input.loaded.binding.blobId}`,
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
  const hydrationTargets: DocumentAttachmentHydrationTarget[] =
    input.attachments.flatMap((attachment) => {
      const binding = bindingBySlotId.get(attachment.slotId);
      return binding ? [{ attachment, binding }] : [];
    });
  if (hydrationTargets.length === 0) {
    return [];
  }

  const loadedBlobs = (
    await Promise.all(
      hydrationTargets.map((target) =>
        loadDocumentAttachmentBlob({
          ...input,
          ...target,
        }),
      ),
    )
  ).filter(isLoadedDocumentAttachmentBlob);
  if (loadedBlobs.length === 0) {
    return [];
  }

  const writerProjection = await input.apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  if (!writerProjection) {
    const logPrefix = input.logPrefix ?? "Documents";
    input.log?.(
      `${logPrefix}: cannot hydrate attachments for document ${input.documentId} without a writer projection.`,
    );
    return [];
  }

  return Promise.all(
    loadedBlobs.map((loaded) =>
      decryptLoadedDocumentAttachmentBlob({
        ...input,
        loaded,
        writerProjection,
      }),
    ),
  );
}

export async function hydrateDocumentAttachmentBlobsFromRuntime(input: {
  attachments: ReadonlyArray<DocumentAttachment>;
  documentId: string;
  logPrefix?: string | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: DocumentAttachmentHydrationRuntime;
  targetSecretKey: Uint8Array;
}): Promise<HydratedDocumentAttachmentBlob[] | null> {
  return hydrateDocumentAttachmentBlobs({
    apiClient: input.runtime.apiClient,
    attachments: input.attachments,
    documentId: input.documentId,
    execSql: input.runtime.execSql,
    log: input.runtime.log,
    logPrefix: input.logPrefix,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: input.targetSecretKey,
  });
}
