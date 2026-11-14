import type { DocumentSummary } from "@tearleads/client-sdk";
import type { ContactsRuntime } from "./contactStoreTypes";

export async function loadContactDocumentSummary(
  runtime: ContactsRuntime,
  contactId: string,
): Promise<DocumentSummary | null> {
  const containerId = runtime.documents.state.containerId;
  if (!containerId) {
    return null;
  }

  const document = await runtime.loadDocumentSummary(contactId);
  if (
    !document ||
    document.containerId !== containerId ||
    document.documentKind !== "contact"
  ) {
    return null;
  }

  return document;
}
