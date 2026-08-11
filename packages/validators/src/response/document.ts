import { z } from "zod";
import { documentAttributionCounterRangeRefinement } from "../documentAttributionRefinements";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  safeNonNegativeIntegerSchema,
} from "../schema";
import { EffectiveAccessLevelSchema } from "./accessLevel";
import { ReferencedPrincipalStateResponseSchema } from "./principalReference";
import { SyncWatermarkSchema } from "./syncWatermark";

export const ContainerDocumentSummaryResponseSchema = loosePlainObject({
  createdAt: z.string(),
  currentAccessEpoch: z.number(),
  currentAccessStateHash: nonEmptyStringSchema,
  effectiveAccessLevel: EffectiveAccessLevelSchema,
  id: z.string(),
  linkedContainerIds: arraySchema(z.string()),
  referencedPrincipals: arraySchema(ReferencedPrincipalStateResponseSchema),
  updatedAt: z.string(),
});

export type ContainerDocumentSummary = z.infer<
  typeof ContainerDocumentSummaryResponseSchema
>;

export const ContainerDocumentSyncTombstoneResponseSchema = loosePlainObject({
  containerId: z.string(),
  documentId: z.string(),
  updatedAt: z.string(),
});

export type ContainerDocumentSyncTombstone = z.infer<
  typeof ContainerDocumentSyncTombstoneResponseSchema
>;

export const ListContainerDocumentsResponseSchema = loosePlainObject({
  hasMore: z.boolean(),
  items: arraySchema(ContainerDocumentSummaryResponseSchema),
  nextWatermark: SyncWatermarkSchema.nullable(),
  tombstones: arraySchema(ContainerDocumentSyncTombstoneResponseSchema),
});

export type ListContainerDocumentsResponse = z.infer<
  typeof ListContainerDocumentsResponseSchema
>;

const DocumentEditAttributionSegmentShape = {
  authorityKind: z.literal(["direct", "baseline"]),
  endCounter: safeNonNegativeIntegerSchema,
  peerId: nonEmptyStringSchema,
  startCounter: safeNonNegativeIntegerSchema,
  writerKeyFingerprint: nonEmptyStringSchema,
  writerUserId: nonEmptyStringSchema,
} as const;

const DocumentEditAttributionSegmentResponseViewSchema = z.looseObject(
  DocumentEditAttributionSegmentShape,
);

export const DocumentEditAttributionSegmentResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      loosePlainObject(DocumentEditAttributionSegmentShape).refine(
        (segment) => segment.startCounter < segment.endCounter,
        { message: "Attribution segment start must precede its end" },
      ),
      DocumentEditAttributionSegmentResponseViewSchema,
    ),
    [documentAttributionCounterRangeRefinement],
  );

export type DocumentEditAttributionSegmentResponse = z.infer<
  typeof DocumentEditAttributionSegmentResponseSchema
>;

const DocumentEditAttributionRangeShape = {
  ...DocumentEditAttributionSegmentShape,
  updateId: nonEmptyStringSchema,
} as const;

const DocumentEditAttributionRangeResponseViewSchema = z.looseObject(
  DocumentEditAttributionRangeShape,
);

export const DocumentEditAttributionRangeResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      loosePlainObject(DocumentEditAttributionRangeShape).refine(
        (range) => range.startCounter < range.endCounter,
        { message: "Attribution range start must precede its end" },
      ),
      DocumentEditAttributionRangeResponseViewSchema,
    ),
    [documentAttributionCounterRangeRefinement],
  );

export type DocumentEditAttributionRangeResponse = z.infer<
  typeof DocumentEditAttributionRangeResponseSchema
>;

export const DocumentEditAttributionResponseSchema = loosePlainObject({
  attributionRevision: safeNonNegativeIntegerSchema,
  documentId: nonEmptyStringSchema,
  segments: arraySchema(DocumentEditAttributionSegmentResponseSchema),
  /** True when the compact interval list hit the API response safety limit. */
  truncated: z.boolean().optional(),
});

export type DocumentEditAttributionResponse = z.infer<
  typeof DocumentEditAttributionResponseSchema
>;

const DocumentEditAttributionRangesPageShape = {
  attributionRevision: safeNonNegativeIntegerSchema,
  documentId: nonEmptyStringSchema,
  items: arraySchema(DocumentEditAttributionRangeResponseSchema, 500),
} as const;

const ListDocumentEditAttributionRangesResponseViewSchema = z.union([
  loosePlainObject({
    ...DocumentEditAttributionRangesPageShape,
    hasMore: z.literal(true),
    nextCursor: nonEmptyStringSchema,
  }),
  loosePlainObject({
    ...DocumentEditAttributionRangesPageShape,
    hasMore: z.literal(false),
    nextCursor: z.null(),
  }),
]);

export const ListDocumentEditAttributionRangesResponseSchema =
  registerJsonSchemaView(
    loosePlainObject({
      ...DocumentEditAttributionRangesPageShape,
      hasMore: z.boolean(),
      nextCursor: z.string().nullable(),
    }).superRefine((page, context) => {
      const cursorMatchesPage = page.hasMore
        ? page.nextCursor !== null && page.nextCursor.length > 0
        : page.nextCursor === null;
      if (!cursorMatchesPage) {
        context.addIssue({
          code: "custom",
          message: "Attribution range cursor must match the page state",
          path: ["nextCursor"],
        });
      }
    }),
    ListDocumentEditAttributionRangesResponseViewSchema,
  );

export type ListDocumentEditAttributionRangesResponse = z.infer<
  typeof ListDocumentEditAttributionRangesResponseSchema
>;

export function isDocumentEditAttributionResponse(
  value: unknown,
): value is DocumentEditAttributionResponse {
  return DocumentEditAttributionResponseSchema.safeParse(value).success;
}

export function isListDocumentEditAttributionRangesResponse(
  value: unknown,
): value is ListDocumentEditAttributionRangesResponse {
  return ListDocumentEditAttributionRangesResponseSchema.safeParse(value)
    .success;
}

export function isListContainerDocumentsResponse(
  value: unknown,
): value is ListContainerDocumentsResponse {
  return ListContainerDocumentsResponseSchema.safeParse(value).success;
}
