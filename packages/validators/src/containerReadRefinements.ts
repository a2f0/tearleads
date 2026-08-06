export const containerKekLogSingleKeyringRefinement = {
  description: "a container KEK log page contains at most one sealed keyring",
  id: "response.container-kek-log-single-keyring",
} as const;

const containerDocumentWatermarkRefinement = {
  description:
    "container-document watermark fields must be supplied together with a parseable date",
  id: "request.container-documents-watermark",
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

export const containerDocumentRuntimeRefinements = [
  containerDocumentWatermarkRefinement,
] as const;

export const containerParentLaneRuntimeRefinements = [
  containerParentLaneRequestUniqueIdsRefinement,
  containerParentLaneRequestPageTotalRefinement,
  containerParentLaneResponseUniqueIdsRefinement,
] as const;
