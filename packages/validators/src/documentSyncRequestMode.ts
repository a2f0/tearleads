interface DocumentSyncRequestModeFacts {
  readonly authorizingContainerPathRefsPresent: boolean;
  readonly hasContainerRekeys: boolean;
  readonly hasOutgoingUpdates: boolean;
}

export type DocumentSyncRequestModeClassification =
  | "invalid-authorizing-path-refs-absent"
  | "invalid-rekeys-without-write"
  | "read-only"
  | "write";

export function classifyDocumentSyncRequestMode({
  authorizingContainerPathRefsPresent,
  hasContainerRekeys,
  hasOutgoingUpdates,
}: DocumentSyncRequestModeFacts): DocumentSyncRequestModeClassification {
  if (!hasOutgoingUpdates) {
    return hasContainerRekeys ? "invalid-rekeys-without-write" : "read-only";
  }

  return authorizingContainerPathRefsPresent
    ? "write"
    : "invalid-authorizing-path-refs-absent";
}
