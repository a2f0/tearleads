import type { ListDocumentEditAttributionRangesOptions } from "../../types";
import { pathSegment } from "../path";

export function documentAttributionRangesPath(
  documentId: string,
  options: ListDocumentEditAttributionRangesOptions = {},
): string {
  const params = new URLSearchParams();
  if (options.cursor !== undefined && options.cursor !== null) {
    params.set("cursor", options.cursor);
  }
  if (options.expectedRevision !== undefined) {
    params.set("expectedRevision", String(options.expectedRevision));
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  const path = `/documents/${pathSegment(documentId)}/attribution/ranges`;
  const query = params.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}
