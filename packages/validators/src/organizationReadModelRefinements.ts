const organizationReadModelConsistencyRefinement = {
  description:
    "read-model lanes match the response organization; grants and memberships are unambiguous; snapshot lanes are complete and contain no deletions",
  id: "response.organization-read-model-consistency",
} as const;

export const organizationReadModelResponseRuntimeRefinements = [
  organizationReadModelConsistencyRefinement,
] as const;
