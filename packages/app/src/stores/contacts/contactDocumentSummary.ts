import {
  type DocumentSummary,
  defaultDocumentsPersistence,
} from "@tearleads/client-sdk";
import type { ContactsStoreState } from "./contactStoreTypes";

export async function loadContactDocumentSummary(
  state: ContactsStoreState,
  contactId: string,
): Promise<DocumentSummary | null> {
  const containerId = state.runtime.documents.state.containerId;
  if (!containerId) {
    return null;
  }

  const documents =
    await defaultDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
      state.runtime.documents.infra.execSql,
      {
        containerIds: [containerId],
        documentIds: [],
      },
    );
  const document = documents.find((row) => row.id === contactId) ?? null;
  if (!document || document.documentKind !== "contact") {
    return null;
  }

  return document;
}
