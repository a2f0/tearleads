import { bytesToHex } from "@tearleads/crypto";
import type {
  BlobAttachmentSummary,
  BlobResponse,
  DocumentWriterProjectionResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../../data/blobContracts";
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
  blob: BlobResponse;
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

  return {
    attachment: input.attachment,
    binding,
    blob,
  };
}

async function decryptLoadedDocumentAttachmentBlob(
  input: DocumentAttachmentHydrationContext & {
    loaded: LoadedDocumentAttachmentBlob;
    writerProjection: DocumentWriterProjectionResponse;
  },
): Promise<HydratedDocumentAttachmentBlob> {
  const { blob } = input.loaded;
  const bytes = await decryptDocumentAttachmentBlob({
    encryptedBytes: blob.encryptedBytes,
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
