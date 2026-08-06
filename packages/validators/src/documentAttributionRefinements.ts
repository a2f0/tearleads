export const documentAttributionCounterRangeRefinement = {
  description:
    "document attribution segment start counters are less than end counters",
  id: "response.document-attribution-counter-range",
} as const;

export const documentAttributionResponseRuntimeRefinements = [
  documentAttributionCounterRangeRefinement,
] as const;
