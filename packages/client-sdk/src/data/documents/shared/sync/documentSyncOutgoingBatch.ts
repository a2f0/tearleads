import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
} from "@tearleads/validators/util";

interface DocumentSyncPendingUpdate {
  readonly updateData: string;
}

interface DocumentSyncOutgoingBatchOptions {
  readonly reservedDataCharacters?: number | undefined;
  readonly reservedUpdateCount?: number | undefined;
}

export class DocumentSyncRequestLimitError extends Error {
  override readonly name = "DocumentSyncRequestLimitError";
}

export function isDocumentSyncRequestLimitError(
  error: unknown,
): error is DocumentSyncRequestLimitError {
  return (
    error instanceof DocumentSyncRequestLimitError ||
    (error instanceof Error && error.name === "DocumentSyncRequestLimitError")
  );
}

function assertReservedCapacity(
  reservedDataCharacters: number,
  reservedUpdateCount: number,
): void {
  if (
    !Number.isSafeInteger(reservedDataCharacters) ||
    reservedDataCharacters < 0 ||
    reservedDataCharacters > MAX_DOCUMENT_SYNC_REQUEST_BYTES
  ) {
    throw new DocumentSyncRequestLimitError(
      "Document sync reserved update data exceeds its limit",
    );
  }
  if (
    !Number.isSafeInteger(reservedUpdateCount) ||
    reservedUpdateCount < 0 ||
    reservedUpdateCount > MAX_DOCUMENT_SYNC_OUTGOING_UPDATES
  ) {
    throw new Error("Document sync reserved update count exceeds its limit");
  }
}

export function selectDocumentSyncOutgoingBatch<
  Update extends DocumentSyncPendingUpdate,
>(
  updates: readonly Update[],
  options: DocumentSyncOutgoingBatchOptions = {},
): Update[] {
  const reservedDataCharacters = options.reservedDataCharacters ?? 0;
  const reservedUpdateCount = options.reservedUpdateCount ?? 0;
  assertReservedCapacity(reservedDataCharacters, reservedUpdateCount);

  const availableCount =
    MAX_DOCUMENT_SYNC_OUTGOING_UPDATES - reservedUpdateCount;
  const availableDataCharacters =
    MAX_DOCUMENT_SYNC_REQUEST_BYTES - reservedDataCharacters;
  const selected: Update[] = [];
  let selectedDataCharacters = 0;

  for (const update of updates) {
    if (selected.length >= availableCount) {
      break;
    }
    if (update.updateData.length > MAX_DOCUMENT_SYNC_REQUEST_BYTES) {
      throw new DocumentSyncRequestLimitError(
        "Document sync update exceeds its data limit",
      );
    }
    if (
      selectedDataCharacters + update.updateData.length >
      availableDataCharacters
    ) {
      break;
    }
    selected.push(update);
    selectedDataCharacters += update.updateData.length;
  }

  return selected;
}

const TEXT_ENCODER = new TextEncoder();

function serializedBytes(value: unknown): number {
  return TEXT_ENCODER.encode(JSON.stringify(value)).byteLength;
}

/**
 * A request without a version vector pulls the whole history, so it cannot
 * carry the processed cursor recorded with that vector either.
 */
function withoutLocalVersionVector(
  request: DocumentSyncRequest,
): DocumentSyncRequest {
  const { processedThroughUpdateId: _cursor, ...rest } = request;
  return { ...rest, localVersionVector: null };
}
/** Whether `updates` begins with exactly the updates `ids` name, in order. */
function startsWithUpdates(
  updates: DocumentSyncRequest["outgoingUpdates"],
  ids: readonly string[],
): boolean {
  return ids.every((id, index) => updates[index]?.id === id);
}

/**
 * Trim a request's outgoing updates to what fits its byte ceiling.
 * `requiredOutgoingUpdateIds` names the updates the request cannot go
 * without, a heal's rotation baseline, which lead it in order: a request
 * that cannot carry them all throws `DocumentSyncRequestLimitError`.
 */
export function limitDocumentSyncRequestBytes(
  request: DocumentSyncRequest,
  options: {
    readonly requiredOutgoingUpdateIds?: readonly string[] | undefined;
  } = {},
): DocumentSyncRequest {
  const requiredUpdateIds = options.requiredOutgoingUpdateIds ?? [];
  if (!startsWithUpdates(request.outgoingUpdates, requiredUpdateIds)) {
    throw new Error("Document sync required updates do not lead their batch");
  }

  const fitRequest = (
    candidate: DocumentSyncRequest,
  ): DocumentSyncRequest | null => {
    const selected: DocumentSyncRequest["outgoingUpdates"] = [];
    let selectedRequestBytes = serializedBytes({
      ...candidate,
      outgoingUpdates: [],
    });
    if (selectedRequestBytes > MAX_DOCUMENT_SYNC_REQUEST_BYTES) return null;
    for (const update of candidate.outgoingUpdates) {
      // The empty request already contains the array brackets. Each selected
      // item contributes its own serialization and, after the first, one comma.
      // This keeps exact UTF-8 accounting linear in the request size.
      const addedBytes =
        serializedBytes(update) + (selected.length > 0 ? 1 : 0);
      if (selectedRequestBytes + addedBytes > MAX_DOCUMENT_SYNC_REQUEST_BYTES) {
        break;
      }
      selected.push(update);
      selectedRequestBytes += addedBytes;
    }

    if (selected.length === candidate.outgoingUpdates.length) return candidate;
    return selected.length > 0
      ? { ...candidate, outgoingUpdates: selected }
      : null;
  };

  const bounded =
    fitRequest(request) ??
    (request.localVersionVector === null
      ? null
      : fitRequest(withoutLocalVersionVector(request)));
  if (!bounded) {
    throw new DocumentSyncRequestLimitError(
      "Document sync update cannot fit within the request limit",
    );
  }
  if (!startsWithUpdates(bounded.outgoingUpdates, requiredUpdateIds)) {
    throw new DocumentSyncRequestLimitError(
      "Document sync required updates exceed the request limit",
    );
  }

  return bounded;
}
