import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_UPDATE_DATA_CHARACTERS,
} from "@symcrypt/validators/util";

interface DocumentSyncPendingUpdate {
  readonly updateData: string;
}

interface DocumentSyncOutgoingBatchOptions {
  readonly reservedDataCharacters?: number | undefined;
  readonly reservedUpdateCount?: number | undefined;
}

function assertReservedCapacity(
  reservedDataCharacters: number,
  reservedUpdateCount: number,
): void {
  if (
    !Number.isSafeInteger(reservedDataCharacters) ||
    reservedDataCharacters < 0 ||
    reservedDataCharacters > MAX_DOCUMENT_SYNC_UPDATE_DATA_CHARACTERS
  ) {
    throw new Error("Document sync reserved update data exceeds its limit");
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
    MAX_DOCUMENT_SYNC_UPDATE_DATA_CHARACTERS - reservedDataCharacters;
  const selected: Update[] = [];
  let selectedDataCharacters = 0;

  for (const update of updates) {
    if (selected.length >= availableCount) {
      break;
    }
    if (update.updateData.length > MAX_DOCUMENT_SYNC_UPDATE_DATA_CHARACTERS) {
      throw new Error("Document sync update exceeds its data limit");
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

function serializedRequestBytes(request: DocumentSyncRequest): number {
  return new TextEncoder().encode(JSON.stringify(request)).byteLength;
}

export function limitDocumentSyncRequestBytes(
  request: DocumentSyncRequest,
  options: { readonly requiredOutgoingUpdateId?: string | undefined } = {},
): DocumentSyncRequest {
  const requiredUpdateId = options.requiredOutgoingUpdateId;
  if (
    requiredUpdateId !== undefined &&
    request.outgoingUpdates[0]?.id !== requiredUpdateId
  ) {
    throw new Error("Document sync required update is not first in its batch");
  }
  if (serializedRequestBytes(request) <= MAX_DOCUMENT_SYNC_REQUEST_BYTES) {
    return request;
  }

  const selected: DocumentSyncRequest["outgoingUpdates"] = [];
  for (const update of request.outgoingUpdates) {
    const candidate = { ...request, outgoingUpdates: [...selected, update] };
    if (serializedRequestBytes(candidate) > MAX_DOCUMENT_SYNC_REQUEST_BYTES) {
      break;
    }
    selected.push(update);
  }

  if (selected.length === 0) {
    throw new Error("Document sync update cannot fit within the request limit");
  }
  if (requiredUpdateId !== undefined && selected[0]?.id !== requiredUpdateId) {
    throw new Error("Document sync required update exceeds the request limit");
  }

  return { ...request, outgoingUpdates: selected };
}
