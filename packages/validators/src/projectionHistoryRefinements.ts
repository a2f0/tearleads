export const projectionHistoryHeaderRefinement = {
  id: "request.projection-history-prefixes",
  description:
    "x-projection-history must decode to at most 32 prefixes with unique keys, positive safe integer counts, and lowercase SHA-256 digests",
} as const;
