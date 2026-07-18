import { z } from "zod";

export const ORGANIZATION_DOCUMENT_USAGE_CATEGORIES = [
  "containerMetadata",
  "rosterProfiles",
  "organizationMetadata",
  "user",
] as const;

export const OrganizationDocumentUsageCategorySchema = z.enum(
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
);

export type OrganizationDocumentUsageCategory = z.infer<
  typeof OrganizationDocumentUsageCategorySchema
>;

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const OrganizationDocumentUsageCategoryBreakdownSchema = z.strictObject({
  byteLength: safeNonNegativeIntegerSchema,
  category: OrganizationDocumentUsageCategorySchema,
  documentCount: safeNonNegativeIntegerSchema,
  updateCount: safeNonNegativeIntegerSchema,
});

export type OrganizationDocumentUsageCategoryBreakdown = z.infer<
  typeof OrganizationDocumentUsageCategoryBreakdownSchema
>;

const OrganizationDocumentUsageBreakdownSchema = z
  .array(OrganizationDocumentUsageCategoryBreakdownSchema)
  .length(ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.length)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.category)).size ===
      ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.length,
    { message: "Organization document usage categories must be unique" },
  );

function sumUsageField(
  entries: OrganizationDocumentUsageCategoryBreakdown[],
  field: "byteLength" | "documentCount" | "updateCount",
): bigint {
  return entries.reduce((total, entry) => total + BigInt(entry[field]), 0n);
}

const OrganizationDocumentDataUsageResponseSchema = z
  .strictObject({
    breakdown: OrganizationDocumentUsageBreakdownSchema,
    byteLength: safeNonNegativeIntegerSchema,
    documentCount: safeNonNegativeIntegerSchema,
    updateCount: safeNonNegativeIntegerSchema,
  })
  .superRefine((documents, context) => {
    for (const field of [
      "byteLength",
      "documentCount",
      "updateCount",
    ] as const) {
      if (
        BigInt(documents[field]) !== sumUsageField(documents.breakdown, field)
      ) {
        context.addIssue({
          code: "custom",
          message: `Organization document usage ${field} does not match its breakdown`,
          path: [field],
        });
      }
    }
  });

export type OrganizationDocumentDataUsageResponse = z.infer<
  typeof OrganizationDocumentDataUsageResponseSchema
>;

const OrganizationBlobDataUsageResponseSchema = z.strictObject({
  blobCount: safeNonNegativeIntegerSchema,
  byteLength: safeNonNegativeIntegerSchema,
});

export type OrganizationBlobDataUsageResponse = z.infer<
  typeof OrganizationBlobDataUsageResponseSchema
>;

export const OrganizationDataUsageResponseSchema = z
  .strictObject({
    organizationId: z.string().min(1),
    blobs: OrganizationBlobDataUsageResponseSchema,
    documents: OrganizationDocumentDataUsageResponseSchema,
    totalByteLength: safeNonNegativeIntegerSchema,
  })
  .superRefine((usage, context) => {
    if (
      BigInt(usage.totalByteLength) !==
      BigInt(usage.documents.byteLength) + BigInt(usage.blobs.byteLength)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Organization total usage does not match document and blob usage",
        path: ["totalByteLength"],
      });
    }
  });

export type OrganizationDataUsageResponse = z.infer<
  typeof OrganizationDataUsageResponseSchema
>;

export function isOrganizationDataUsageResponse(
  value: unknown,
): value is OrganizationDataUsageResponse {
  return OrganizationDataUsageResponseSchema.safeParse(value).success;
}
