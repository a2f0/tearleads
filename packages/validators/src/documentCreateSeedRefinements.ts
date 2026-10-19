export const documentCreateSeedRefinement = {
  description:
    "a document create seed must contain exactly one outgoing update and no container rekeys",
  id: "request.document-create-seed",
} as const;

export const containerCreateMetadataSeedRefinement = {
  description:
    "a container create metadata seed must contain exactly one outgoing update and no container rekeys",
  id: "request.container-create-metadata-seed",
} as const;
