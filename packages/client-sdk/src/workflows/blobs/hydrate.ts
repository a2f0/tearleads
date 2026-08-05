import type { BlobBytesResponse } from "@tearleads/api-client";
import { bytesToHex } from "@tearleads/crypto";
import type {
  BlobAttachmentSummary,
  DocumentWriterProjectionResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../../data/blobContracts";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import { errorMessage } from "../../data/errorMessage";
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

interface DocumentAttachmentHydrationContext {
  apiClient: DocumentAttachmentHydrationApi;
  documentId: string;
  execSql: ExecSql;
  localBlobIdBySlotId?:
    | Readonly<Record<string, string | null | undefined>>
    | undefined;
  localStorageKeyBySlotId?: Readonly<Record<string, string | undefined>>;
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
  encryptedBytes: Uint8Array<ArrayBuffer>;
}

interface LoadedDocumentAttachmentBlobBytes {
  blobId: string;
  encryptedBytes: Uint8Array<ArrayBuffer>;
}

async function readBlobStreamBytes(
  blob: BlobBytesResponse,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(blob.encryptedBytes).arrayBuffer());
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

function shouldHydrateAttachment(input: {
  attachment: DocumentAttachment;
  binding: BlobAttachmentSummary;
  localBlobIdBySlotId:
    | Readonly<Record<string, string | null | undefined>>
    | undefined;
  localStorageKeyBySlotId:
    | Readonly<Record<string, string | undefined>>
    | undefined;
}): boolean {
  const slotId = input.attachment.slotId;
  const localStorageKey = input.localStorageKeyBySlotId?.[slotId];
  if (!localStorageKey) {
    return true;
  }

  const localBlobId = input.localBlobIdBySlotId?.[slotId];
  return localBlobId !== null && localBlobId !== input.binding.blobId;
}

async function loadDocumentAttachmentBlob(
  input: DocumentAttachmentHydrationContext & {
    binding: BlobAttachmentSummary;
  },
): Promise<LoadedDocumentAttachmentBlobBytes | null> {
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
      `${logPrefix}: blob ${binding.blobId} failed to stream during hydration: ${errorMessage(
        error,
      )}`,
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
    blobId: binding.blobId,
    encryptedBytes,
  };
}

async function loadUniqueDocumentAttachmentBlobs(
  input: DocumentAttachmentHydrationContext & {
    hydrationTargets: ReadonlyArray<DocumentAttachmentHydrationTarget>;
  },
): Promise<ReadonlyMap<string, LoadedDocumentAttachmentBlobBytes>> {
  const targetsByBlobId = new Map<string, DocumentAttachmentHydrationTarget>();
  for (const target of input.hydrationTargets) {
    if (!targetsByBlobId.has(target.binding.blobId)) {
      targetsByBlobId.set(target.binding.blobId, target);
    }
  }

  const loadedBlobs = await Promise.all(
    Array.from(targetsByBlobId.values()).map((target) =>
      loadDocumentAttachmentBlob({
        ...input,
        binding: target.binding,
      }),
    ),
  );

  return new Map(
    loadedBlobs.flatMap((loaded) =>
      loaded ? [[loaded.blobId, loaded] as const] : [],
    ),
  );
}

function applyLoadedBlobBytesToHydrationTargets(
  hydrationTargets: ReadonlyArray<DocumentAttachmentHydrationTarget>,
  loadedBlobsByBlobId: ReadonlyMap<string, LoadedDocumentAttachmentBlobBytes>,
): LoadedDocumentAttachmentBlob[] {
  return hydrationTargets.flatMap((target) => {
    const loaded = loadedBlobsByBlobId.get(target.binding.blobId);
    return loaded
      ? [
          {
            ...target,
            encryptedBytes: loaded.encryptedBytes,
          },
        ]
      : [];
  });
}

async function decryptLoadedDocumentAttachmentBlob(
  input: DocumentAttachmentHydrationContext & {
    loaded: LoadedDocumentAttachmentBlob;
    writerProjection: DocumentWriterProjectionResponse;
  },
): Promise<HydratedDocumentAttachmentBlob> {
  const bytes = await decryptDocumentAttachmentBlob({
    contentKeyBundle: input.loaded.binding.contentKeyBundle,
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
      return binding &&
        shouldHydrateAttachment({
          attachment,
          binding,
          localBlobIdBySlotId: input.localBlobIdBySlotId,
          localStorageKeyBySlotId: input.localStorageKeyBySlotId,
        })
        ? [{ attachment, binding }]
        : [];
    });
  if (hydrationTargets.length === 0) {
    return [];
  }

  const loadedBlobs = applyLoadedBlobBytesToHydrationTargets(
    hydrationTargets,
    await loadUniqueDocumentAttachmentBlobs({
      ...input,
      hydrationTargets,
    }),
  );
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
