import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  type BlobWriteAuthorization,
} from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import type { ListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import { getStoredAccessEvents } from "../../access/read/accessManifestStore";
import {
  BlobContentKeyBundleError,
  getLatestCurrentBlobContentKeyBundle,
  listBlobContentWriteHeaders,
} from "../../access/read/blobContentKeyStore";
import {
  BlobKekTargetError,
  resolveCurrentBlobKekTargets,
} from "../../access/read/blobKekTargets";
import { projectionVerifiedAccessEventRecord } from "../../keyingProjectionRecords";
import { uniqueSortedStrings } from "../../utils/array";
import {
  toBlobKekTargetsResponse,
  toContentKeyBundleResponse,
} from "../blobs/mutations/records";
import {
  KeyingReadAccessError,
  resolveReadableDocumentAccess,
} from "../keyingReadAccess";

interface ListDocumentAttachmentsWorkflowInput {
  documentId: string;
  userId: string;
}

type CurrentBlobContentKeyBundle = NonNullable<
  Awaited<ReturnType<typeof getLatestCurrentBlobContentKeyBundle>>
>;

interface BlobContentKeyBundleEntry {
  readonly blobId: string;
  readonly contentKeyBundle: CurrentBlobContentKeyBundle;
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentBlobKekTargets>
  >;
  readonly writeHeader: {
    readonly authorization: BlobWriteAuthorization;
    readonly header: WriteHeader;
    readonly headerHash: string;
  };
}

export class ListDocumentAttachmentsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

async function loadCurrentBlobContentKeyBundleEntry(
  blobId: string,
  writeHeader: BlobContentKeyBundleEntry["writeHeader"] | undefined,
  executor: DatabaseSession,
): Promise<BlobContentKeyBundleEntry> {
  try {
    const currentTargets = await resolveCurrentBlobKekTargets(blobId, executor);
    const contentKeyBundle = await getLatestCurrentBlobContentKeyBundle(
      { blobId, currentTargets },
      executor,
    );
    if (!contentKeyBundle) {
      throw new ListDocumentAttachmentsError(
        "Blob content-key bundle missing",
        409,
      );
    }
    if (!writeHeader) {
      throw new ListDocumentAttachmentsError("Blob write header missing", 409);
    }
    return { blobId, contentKeyBundle, currentTargets, writeHeader };
  } catch (error) {
    if (
      error instanceof BlobKekTargetError ||
      error instanceof BlobContentKeyBundleError
    ) {
      throw new ListDocumentAttachmentsError(error.message, error.status);
    }
    throw error;
  }
}

function loadActiveAttachmentRows(
  documentId: string,
  executor: DatabaseSession,
) {
  return executor
    .select({
      bindingId: attachmentBindings.id,
      attachmentEventHash: attachmentBindings.attachmentEventHash,
      blobId: attachmentBindings.blobId,
      documentManifestHash: attachmentBindings.documentManifestHash,
      previousBindingId: attachmentBindings.previousBindingId,
      slotId: attachmentBindings.slotId,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, documentId),
        isNull(attachmentBindings.detachedAt),
      ),
    );
}

export async function runListDocumentAttachmentsWorkflow(
  executor: DatabaseSession,
  input: ListDocumentAttachmentsWorkflowInput,
): Promise<ListDocumentAttachmentsResponse> {
  try {
    await resolveReadableDocumentAccess({
      documentId: input.documentId,
      executor,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new ListDocumentAttachmentsError(error.message, error.status);
    }
    throw error;
  }

  const rows = await loadActiveAttachmentRows(input.documentId, executor);

  const blobIds = uniqueSortedStrings(rows.map((row) => row.blobId));
  const writeHeadersByBlobId = await listBlobContentWriteHeaders(
    blobIds,
    executor,
  );
  const bindingEventsByHash = await getStoredAccessEvents(
    rows.flatMap((row) =>
      row.attachmentEventHash ? [row.attachmentEventHash] : [],
    ),
    executor,
  );
  const contentKeyBundleEntries = await gatherWithExecutor(
    executor,
    blobIds,
    (blobId) =>
      loadCurrentBlobContentKeyBundleEntry(
        blobId,
        writeHeadersByBlobId.get(blobId),
        executor,
      ),
  );
  const contentKeyBundleByBlobId = new Map<string, BlobContentKeyBundleEntry>();
  for (const entry of contentKeyBundleEntries) {
    contentKeyBundleByBlobId.set(entry.blobId, entry);
  }

  return rows.map((row) => {
    const blobKeying = contentKeyBundleByBlobId.get(row.blobId);
    if (!blobKeying) {
      throw new ListDocumentAttachmentsError(
        "Blob content-key bundle missing",
        409,
      );
    }
    if (!row.attachmentEventHash || !row.documentManifestHash) {
      // A partial listing would let the server hide an attachment without the
      // client detecting that its binding evidence was omitted.
      throw new ListDocumentAttachmentsError(
        "Attachment binding verification material missing",
        409,
      );
    }
    const bindingEvent = bindingEventsByHash.get(row.attachmentEventHash);
    if (!bindingEvent) {
      throw new ListDocumentAttachmentsError(
        "Attachment binding event missing",
        409,
      );
    }

    return {
      bindingEvent: projectionVerifiedAccessEventRecord(bindingEvent),
      bindingId: row.bindingId,
      blobId: row.blobId,
      blobKekTargets: toBlobKekTargetsResponse(blobKeying.currentTargets),
      contentKeyBundle: toContentKeyBundleResponse(blobKeying.contentKeyBundle),
      documentManifestHash: row.documentManifestHash,
      previousBindingId: row.previousBindingId,
      slotId: row.slotId,
      writeHeader: { ...blobKeying.writeHeader.header },
      writeAuthorization: toBlobKekTargetsResponse(
        blobKeying.writeHeader.authorization,
      ),
    };
  });
}
