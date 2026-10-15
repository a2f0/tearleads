export const containerKekLogSingleKeyringRefinement = {
  description: "a container KEK log page contains at most one sealed keyring",
  id: "response.container-kek-log-single-keyring",
} as const;

export const containerDocumentLaneRequestUniqueIdsRefinement = {
  description: "container document-lane request lane ids must be unique",
  id: "request.container-document-lane-unique-ids",
} as const;

export const containerDocumentLaneRequestPageTotalRefinement = {
  description:
    "container document-lane request page limits must total at most 500",
  id: "request.container-document-lane-page-total",
} as const;

export const containerDocumentLaneResponseUniqueIdsRefinement = {
  description: "container document-lane response lane ids must be unique",
  id: "response.container-document-lane-unique-ids",
} as const;

export const containerParentLaneRequestUniqueIdsRefinement = {
  description: "container parent-lane request lane ids must be unique",
  id: "request.container-parent-lane-unique-ids",
} as const;

export const containerParentLaneRequestPageTotalRefinement = {
  description:
    "container parent-lane request page limits must total at most 500",
  id: "request.container-parent-lane-page-total",
} as const;

export const containerParentLaneResponseUniqueIdsRefinement = {
  description: "container parent-lane response lane ids must be unique",
  id: "response.container-parent-lane-unique-ids",
} as const;

export const containerKekLogResponseRuntimeRefinements = [
  containerKekLogSingleKeyringRefinement,
] as const;

export const containerDocumentLaneRuntimeRefinements = [
  containerDocumentLaneRequestUniqueIdsRefinement,
  containerDocumentLaneRequestPageTotalRefinement,
  containerDocumentLaneResponseUniqueIdsRefinement,
] as const;

export const containerParentLaneRuntimeRefinements = [
  containerParentLaneRequestUniqueIdsRefinement,
  containerParentLaneRequestPageTotalRefinement,
  containerParentLaneResponseUniqueIdsRefinement,
] as const;
