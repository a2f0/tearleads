export const documentCreateSeedRefinement = {
  description:
    "a document create seed must contain exactly one outgoing update and no container rekeys, and serialize within the document sync request limit",
  id: "request.document-create-seed",
} as const;

export const attachmentBindDocumentSyncRefinement = {
  description:
    "an attachment bind's document sync must contain exactly one outgoing update and no container rekeys, and serialize within the document sync request limit",
  id: "request.attachment-bind-document-sync",
} as const;

export const containerCreateMetadataSeedRefinement = {
  description:
    "a container create metadata seed must contain exactly one outgoing update and no container rekeys, and serialize within the document sync request limit",
  id: "request.container-create-metadata-seed",
} as const;
