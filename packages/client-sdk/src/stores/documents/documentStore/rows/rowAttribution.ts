import type { DocumentRowAttribution } from "../../../../data/documents/documentRowList";
import { resolveDocumentCreateAuthor } from "../../../../workflows/documents";
import type { DocumentStoreState } from "../state";

// Stamp each row write with the local signing identity (or "" when
// unauthenticated) and an ISO timestamp, matching the keys the edit-attribution
// layer resolves against.
export function resolveRowAttribution(
  state: DocumentStoreState,
): DocumentRowAttribution {
  return {
    at: new Date().toISOString(),
    userId: resolveDocumentCreateAuthor(state.runtime)?.signerUserId ?? "",
  };
}
