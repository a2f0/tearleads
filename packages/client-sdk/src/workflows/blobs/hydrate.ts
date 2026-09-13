import type { BlobBytesResponse } from "@tearleads/api-client";
import { bytesToHex } from "@tearleads/crypto";
import type {
  BlobAttachmentSummary,
  DocumentWriterProjectionResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../../data/blobContracts";
import { attachmentContentSha256 } from "../../data/documents/attachmentContentIdentity";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import { errorMessage } from "../../data/errorMessage";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createAttachmentDecryptor } from "./attachmentDecryptor";
import { collectHydrationResults } from "./hydrationResults";

interface DocumentAttachmentHydrationApi {
  evictDocumentWriterProjection?(documentId: string): void;
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
  /** Plaintext digest of `bytes`. */
  contentSha256: string;
  /**
   * The served binding is validly signed but its plaintext digest differs
   * from the digest the document content records for the slot. Set only when
   * the slot held no local bytes: the bind and the content update carrying
   * its digest are two server writes, and an uploader lost between them must
   * not leave the attachment permanently invisible. Never a security incident;
   * an honest crash window is indistinguishable from a served rollback.
   */
  intentMismatch: boolean;
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
  /**
   * Served bindings already downloaded and refused for a held copy, keyed per
   * (slot, binding, intent). Populated here; a later pass skips the download
   * until the binding or the document intent changes.
   */
  rejectedServedBindings?: Set<string> | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  reportSecurityIncident?: SecurityIncidentReporter | undefined;
  targetSecretKey: Uint8Array;
}

function servedBindingRejectionKey(
  attachment: DocumentAttachment,
  binding: BlobAttachmentSummary,
): string {
  return JSON.stringify([
    attachment.slotId,
    binding.bindingId,
    attachment.contentSha256,
  ]);
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
  rejectedServedBindings: ReadonlySet<string> | undefined;
}): boolean {
  const slotId = input.attachment.slotId;
  const localStorageKey = input.localStorageKeyBySlotId?.[slotId];
  // An empty slot always hydrates: a rejection only ever protected a held
  // copy, so once that copy is gone the served binding is shown (flagged).
  if (!localStorageKey) {
    return true;
  }
  if (
    input.rejectedServedBindings?.has(
      servedBindingRejectionKey(input.attachment, input.binding),
    )
  ) {
    return false;
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

  const loadedBlobs = await collectHydrationResults({
    ...input,
    tasks: Array.from(targetsByBlobId.values()).map((target) => ({
      blobId: target.binding.blobId,
      run: () =>
        loadDocumentAttachmentBlob({ ...input, binding: target.binding }),
    })),
  });

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
    decryptAttachment: ReturnType<typeof createAttachmentDecryptor>;
    writerProjection: DocumentWriterProjectionResponse;
  },
): Promise<HydratedDocumentAttachmentBlob | null> {
  const bytes = await input.decryptAttachment({
    binding: input.loaded.binding,
    encryptedBytes: input.loaded.encryptedBytes,
    expectedDocumentId: input.documentId,
    expectedSlotId: input.loaded.attachment.slotId,
    execSql: input.execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
  });

  const { attachment, binding } = input.loaded;
  const contentSha256 = await attachmentContentSha256(bytes);
  const intentMismatch = contentSha256 !== attachment.contentSha256;
  const logPrefix = input.logPrefix ?? "Documents";
  if (intentMismatch && input.localStorageKeyBySlotId?.[attachment.slotId]) {
    // Never replace a held copy with bytes the document does not record.
    input.rejectedServedBindings?.add(
      servedBindingRejectionKey(attachment, binding),
    );
    input.log?.(
      `${logPrefix}: served attachment bytes differ from the current document content; keeping the held copy.`,
    );
    return null;
  }
  if (intentMismatch) {
    input.log?.(
      `${logPrefix}: served attachment bytes differ from the current document content; showing them flagged.`,
    );
  }
  return {
    attachment,
    binding,
    bytes,
    contentSha256,
    intentMismatch,
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
  const hydrationTargets: DocumentAttachmentHydrationTarget[] =
    input.attachments.flatMap((attachment) => {
      const binding = bindingBySlotId.get(attachment.slotId);
      return binding &&
        shouldHydrateAttachment({
          attachment,
          binding,
          localBlobIdBySlotId: input.localBlobIdBySlotId,
          localStorageKeyBySlotId: input.localStorageKeyBySlotId,
          rejectedServedBindings: input.rejectedServedBindings,
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

  const decryptAttachment = createAttachmentDecryptor(
    input.apiClient,
    input.documentId,
  );
  const hydrated = await collectHydrationResults({
    ...input,
    tasks: loadedBlobs.map((loaded) => ({
      blobId: loaded.binding.blobId,
      run: () =>
        decryptLoadedDocumentAttachmentBlob({
          ...input,
          decryptAttachment,
          loaded,
          writerProjection,
        }),
    })),
  });
  return hydrated.filter(
    (item): item is HydratedDocumentAttachmentBlob => item !== null,
  );
}
