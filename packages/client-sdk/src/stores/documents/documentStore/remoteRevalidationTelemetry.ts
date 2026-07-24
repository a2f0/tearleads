import { getDocumentAttachments } from "../../../data/documents/documentContent";
import type { DocumentsRuntime } from "../types";
import type { DocumentState, DocumentStoreState } from "./state";

export function logRevalidationScheduled(
  runtime: DocumentsRuntime,
  reason: "reconnect" | "startup",
): void {
  runtime.util.log(`Documents: remote revalidation scheduled reason=${reason}`);
}

export function logRevalidationApplied(
  state: DocumentStoreState,
  doc: DocumentState,
  incomingUpdateCount: number,
  requested: boolean,
): void {
  if (!requested) return;
  state.runtime.util.log(
    `Documents: remote revalidation result=applied incomingUpdates=${incomingUpdateCount} attachmentSlots=${getDocumentAttachments(doc).length}`,
  );
}

export function logRevalidationUnavailable(
  state: DocumentStoreState,
  requested: boolean,
): void {
  if (!requested) return;
  state.runtime.util.log("Documents: remote revalidation result=unavailable");
}
