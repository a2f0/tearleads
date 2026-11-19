import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { isExplorerOrphanedDocumentsId } from "./orphanedDocuments";

/** Resolve the placement represented by an Explorer row against local persistence. */
export async function loadExplorerPlacementSummary(
  queries: ContainerDocumentQueries,
  summary: DocumentSummary,
  containerId: string,
  currentOrganizationId: string | null,
): Promise<DocumentSummary | null> {
  if (isExplorerOrphanedDocumentsId(containerId)) {
    return queries.loadOrphanedDocumentSummary({
      localId: summary.id,
      currentOrganizationId,
      requireHydrated: true,
    });
  }
  if (summary.documentId === null)
    return summary.containerId === containerId ? summary : null;
  const placed = await queries.loadContainerDocumentSummary({
    containerId,
    documentId: summary.documentId,
  });
  return placed?.id === summary.id ? placed : null;
}
