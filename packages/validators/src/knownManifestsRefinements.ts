export const knownManifestsHeaderRefinement = {
  id: "request.known-manifest-hints",
  description:
    "x-known-manifests must list unique typed digests, at most 48 m: or k: and at most 8 d:, each followed by a lowercase SHA-256 hex digest",
} as const;
