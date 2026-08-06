import { z } from "zod";
import { documentAttributionCounterRangeRefinement } from "../documentAttributionRefinements";
import { isPlainObject } from "../isPlainObject";
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
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";
import {
  type EffectiveAccessLevel,
  isEffectiveAccessLevel,
} from "./accessLevel";
import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "./principal";
import { isSyncWatermark, type SyncWatermark } from "./syncWatermark";

export interface ContainerDocumentSummary {
  createdAt: string;
  currentAccessEpoch: number;
  currentAccessStateHash: string;
  effectiveAccessLevel: EffectiveAccessLevel;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  updatedAt: string;
}

export interface ContainerDocumentSyncTombstone {
  containerId: string;
  documentId: string;
  updatedAt: string;
}

export interface ListContainerDocumentsResponse {
  hasMore: boolean;
  items: ContainerDocumentSummary[];
  nextWatermark: SyncWatermark | null;
  tombstones: ContainerDocumentSyncTombstone[];
}

function isContainerDocumentSummary(
  value: unknown,
): value is ContainerDocumentSummary {
  const referencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "referencedPrincipals")
    : undefined;
  const currentAccessStateHash = isPlainObject(value)
    ? Reflect.get(value, "currentAccessStateHash")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "createdAt") &&
    hasNumberProperty(value, "currentAccessEpoch") &&
    typeof currentAccessStateHash === "string" &&
    currentAccessStateHash.length > 0 &&
    isEffectiveAccessLevel(Reflect.get(value, "effectiveAccessLevel")) &&
    hasStringProperty(value, "id") &&
    hasArrayProperty(value, "linkedContainerIds") &&
    value.linkedContainerIds.every((entry) => typeof entry === "string") &&
    hasStringProperty(value, "updatedAt") &&
    Array.isArray(referencedPrincipals) &&
    referencedPrincipals.every(isReferencedPrincipalStateResponse)
  );
}

function isContainerDocumentSyncTombstone(
  value: unknown,
): value is ContainerDocumentSyncTombstone {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "updatedAt")
  );
}

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
  const nextWatermark = isPlainObject(value)
    ? Reflect.get(value, "nextWatermark")
    : undefined;

  return (
    isPlainObject(value) &&
    typeof Reflect.get(value, "hasMore") === "boolean" &&
    hasArrayProperty(value, "items") &&
    value.items.every(isContainerDocumentSummary) &&
    (isSyncWatermark(nextWatermark) || nextWatermark === null) &&
    hasArrayProperty(value, "tombstones") &&
    value.tombstones.every(isContainerDocumentSyncTombstone)
  );
}
