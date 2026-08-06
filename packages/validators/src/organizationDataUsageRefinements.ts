export const organizationDocumentUsageCategoriesRefinement = {
  description:
    "the document usage breakdown contains each document category exactly once",
  id: "response.organization-data-usage-document-categories",
} as const;

export const organizationDocumentUsageTotalsRefinement = {
  description: "document usage totals equal the sums of the category breakdown",
  id: "response.organization-data-usage-document-totals",
} as const;

export const organizationDataUsageTotalRefinement = {
  description:
    "totalByteLength equals the sum of document and blob byte lengths",
  id: "response.organization-data-usage-total-byte-length",
} as const;

export const organizationDataUsageResponseRuntimeRefinements = [
  organizationDataUsageTotalRefinement,
  organizationDocumentUsageCategoriesRefinement,
  organizationDocumentUsageTotalsRefinement,
] as const;
