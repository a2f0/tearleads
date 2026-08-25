import type { DocumentRecord, DocumentSummary } from "@symcrypt/client-sdk";

export function buildMemoryDocumentSummaries(
  document: DocumentRecord | null,
): DocumentSummary[] {
  if (!document) return [];
  return [
    {
      containerId: document.containerId,
      documentId: document.documentId,
      id: document.id,
      title: document.text.trim() || "Untitled note",
      updatedAt: "2026-04-06T00:00:00.000Z",
    },
  ];
}
