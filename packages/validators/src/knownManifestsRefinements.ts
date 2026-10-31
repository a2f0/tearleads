export const knownManifestsHeaderRefinement = {
  id: "request.known-manifest-hints",
  description:
    "x-known-manifests must list at most 48 unique typed digests, each m: or k: followed by a lowercase SHA-256 hex digest",
} as const;
