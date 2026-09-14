import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { DocumentStoreState } from "./state";

/**
 * A realtime hint says a manifest this document's projection cites may have
 * moved. Drop the held projection and advance the generation so an operation
 * already in flight cannot reinstall what it fetched before the hint.
 */
export function invalidateDocumentWriterProjection(
  state: DocumentStoreState,
): void {
  state.writerProjection = null;
  state.writerProjectionGeneration += 1;
}

/**
 * Install a projection an operation fetched or was handed back, unless a hint
 * invalidated the document while that operation ran: its answer may predate
 * the hint, so the slot stays empty and the next operation fetches fresh.
 */
export function installDocumentWriterProjection(
  state: DocumentStoreState,
  projection: DocumentWriterProjectionResponse | null,
  capturedGeneration: number,
): void {
  if (state.writerProjectionGeneration !== capturedGeneration) return;
  state.writerProjection = projection;
}
