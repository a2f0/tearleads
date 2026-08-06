import { z } from "zod";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
  toJsonSchema,
} from "../jsonSchema";
import {
  organizationDataUsageTotalRefinement,
  organizationDocumentUsageCategoriesRefinement,
  organizationDocumentUsageTotalsRefinement,
} from "../organizationDataUsageRefinements";

export const ORGANIZATION_DOCUMENT_USAGE_CATEGORIES = [
  "containerMetadata",
  "rosterProfiles",
  "organizationMetadata",
  "user",
] as const;

export const OrganizationDocumentUsageCategorySchema = z.literal(
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
);

export type OrganizationDocumentUsageCategory = z.infer<
  typeof OrganizationDocumentUsageCategorySchema
>;

const safeNonNegativeIntegerSchema = registerJsonSchemaFragment(
  z.custom<number>(
    (value) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  ),
  {
    maximum: Number.MAX_SAFE_INTEGER,
    minimum: 0,
    type: "integer",
  },
);

const OrganizationDocumentUsageCategoryBreakdownSchema = z.strictObject({
  byteLength: safeNonNegativeIntegerSchema,
  category: OrganizationDocumentUsageCategorySchema,
  documentCount: safeNonNegativeIntegerSchema,
  updateCount: safeNonNegativeIntegerSchema,
});

export type OrganizationDocumentUsageCategoryBreakdown = z.infer<
  typeof OrganizationDocumentUsageCategoryBreakdownSchema
>;

const OrganizationDocumentUsageBreakdownJsonSchema = {
  items: toJsonSchema(OrganizationDocumentUsageCategoryBreakdownSchema),
  maxItems: ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.length,
  minItems: ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.length,
  type: "array",
} as const;

const OrganizationDocumentUsageBreakdownBaseSchema = registerJsonSchemaFragment(
  z.array(OrganizationDocumentUsageCategoryBreakdownSchema),
  OrganizationDocumentUsageBreakdownJsonSchema,
);

const OrganizationDocumentUsageBreakdownLengthSchema =
  registerJsonSchemaFragment(
    OrganizationDocumentUsageBreakdownBaseSchema.length(
      ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.length,
    ),
    OrganizationDocumentUsageBreakdownJsonSchema,
  );

const OrganizationDocumentUsageBreakdownSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaFragment(
      OrganizationDocumentUsageBreakdownLengthSchema.refine(
        (entries) =>
          new Set(entries.map((entry) => entry.category)).size ===
          ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.length,
        { message: "Organization document usage categories must be unique" },
      ),
      OrganizationDocumentUsageBreakdownJsonSchema,
    ),
    [organizationDocumentUsageCategoriesRefinement],
  );

function sumUsageField(
  entries: OrganizationDocumentUsageCategoryBreakdown[],
  field: "byteLength" | "documentCount" | "updateCount",
): bigint {
  return entries.reduce((total, entry) => total + BigInt(entry[field]), 0n);
}

const OrganizationDocumentDataUsageResponseJsonSchema = z.strictObject({
  breakdown: OrganizationDocumentUsageBreakdownSchema,
  byteLength: safeNonNegativeIntegerSchema,
  documentCount: safeNonNegativeIntegerSchema,
  updateCount: safeNonNegativeIntegerSchema,
});

const OrganizationDocumentDataUsageResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      OrganizationDocumentDataUsageResponseJsonSchema.superRefine(
        (documents, context) => {
          for (const field of [
            "byteLength",
            "documentCount",
            "updateCount",
          ] as const) {
            if (
              BigInt(documents[field]) !==
              sumUsageField(documents.breakdown, field)
            ) {
              context.addIssue({
                code: "custom",
                message: `Organization document usage ${field} does not match its breakdown`,
                path: [field],
              });
            }
          }
        },
      ),
      OrganizationDocumentDataUsageResponseJsonSchema,
    ),
    [organizationDocumentUsageTotalsRefinement],
  );

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

const OrganizationDataUsageResponseJsonSchema = z.strictObject({
  organizationId: z.string().min(1),
  blobs: OrganizationBlobDataUsageResponseSchema,
  documents: OrganizationDocumentDataUsageResponseSchema,
  totalByteLength: safeNonNegativeIntegerSchema,
});

export const OrganizationDataUsageResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      OrganizationDataUsageResponseJsonSchema.superRefine((usage, context) => {
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
      }),
      OrganizationDataUsageResponseJsonSchema,
    ),
    [organizationDataUsageTotalRefinement],
  );

export type OrganizationDataUsageResponse = z.infer<
  typeof OrganizationDataUsageResponseSchema
>;

export function isOrganizationDataUsageResponse(
  value: unknown,
): value is OrganizationDataUsageResponse {
  return OrganizationDataUsageResponseSchema.safeParse(value).success;
}
