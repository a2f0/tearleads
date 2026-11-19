import type {
  DocumentAttachment,
  DocumentHistoryView,
  Tearleads,
} from "@tearleads/client-sdk";
import type { SeedDocument } from "./seedDocuments";

function containsFields(
  actual: Readonly<Record<string, string>>,
  fields: Readonly<Record<string, string>> = {},
) {
  return Object.entries(fields).every(([key, value]) => actual[key] === value);
}

export async function verifySeedContent(
  sdk: Tearleads,
  document: SeedDocument,
  documentId: string,
  current: DocumentHistoryView,
  attachments: readonly { intent: DocumentAttachment }[],
) {
  const matches = (view: DocumentHistoryView) =>
    view.documentKind === document.kind &&
    view.text === (document.text ?? "") &&
    containsFields(view.structuredFields, document.fields) &&
    (document.rows ?? []).every((fields, index) =>
      containsFields(view.rows[index]?.fields ?? {}, fields),
    ) &&
    attachments.every(({ intent }) =>
      view.attachments.some(
        (item) =>
          item.slotId === intent.slotId &&
          item.contentSha256 === intent.contentSha256 &&
          item.byteLength === intent.byteLength,
      ),
    );
  if (matches(current)) return;
  // Edits and removals keep the original fixture in the signed update history.
  const id = await sdk.documents.findLocalIdByDocumentId(documentId);
  const history = id ? await sdk.documents.openHistory(id) : null;
  try {
    if (!history?.stops.some(({ index }) => matches(history.viewAt(index)))) {
      throw new Error(
        `Seed document has no synced birth content matching ${document.key}.`,
      );
    }
  } finally {
    history?.close();
  }
}
