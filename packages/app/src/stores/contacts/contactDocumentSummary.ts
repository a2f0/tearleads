import type { DocumentSummary } from "@tearleads/client-sdk";
import type { ContactsStoreState } from "./contactStoreTypes";

export async function loadContactDocumentSummary(
  state: ContactsStoreState,
  contactId: string,
): Promise<DocumentSummary | null> {
  const containerId = state.runtime.documents.state.containerId;
  if (!containerId) {
    return null;
  }

  const document = await state.runtime.loadDocumentSummary(contactId);
  if (
    !document ||
    document.containerId !== containerId ||
    document.documentKind !== "contact"
  ) {
    return null;
  }

  return document;
}
