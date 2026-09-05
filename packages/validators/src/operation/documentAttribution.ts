import { z } from "zod";
import { documentAttributionResponseRuntimeRefinements } from "../documentAttributionRefinements";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  DocumentEditAttributionResponseSchema,
  ErrorResponseSchema,
  isDocumentEditAttributionResponse,
  isListDocumentEditAttributionRangesResponse,
  ListDocumentEditAttributionRangesResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { loosePlainObject, nonEmptyStringSchema } from "../schema";
import { defineJsonOperation } from "./definition";

const MAX_ATTRIBUTION_RANGE_LIMIT = 500;
const DIGITS_PATTERN = /^\d+$/u;

interface IntegerQuerySchemaOptions {
  readonly invalidMessage: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly rangeMessage?: string;
}

function integerQuerySchema({
  invalidMessage,
  maximum,
  minimum,
  rangeMessage = invalidMessage,
}: IntegerQuerySchemaOptions) {
  const runtimeSchema = z
    .union([z.number(), z.string()])
    .superRefine((value, context) => {
      if (typeof value === "string" && !DIGITS_PATTERN.test(value)) {
        context.addIssue({ code: "custom", message: invalidMessage });
        return;
      }

      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        context.addIssue({ code: "custom", message: invalidMessage });
        return;
      }
      if (parsed < minimum || parsed > maximum) {
        context.addIssue({ code: "custom", message: rangeMessage });
      }
    });

  return registerJsonSchemaFragment(runtimeSchema, {
    maximum,
    minimum,
    type: "integer",
  });
}

const expectedRevisionSchema = integerQuerySchema({
  invalidMessage: "Document attribution expected revision is invalid",
  maximum: Number.MAX_SAFE_INTEGER,
  minimum: 0,
});

const rangeLimitSchema = integerQuerySchema({
  invalidMessage: "Document attribution range limit is invalid",
  maximum: MAX_ATTRIBUTION_RANGE_LIMIT,
  minimum: 1,
  rangeMessage: `Document attribution range limit must be between 1 and ${MAX_ATTRIBUTION_RANGE_LIMIT}`,
});

export const DocumentAttributionPathParamsSchema = z.strictObject({
  documentId: z.string(),
});

export const DocumentAttributionRangesQuerySchema = loosePlainObject({
  cursor: z.string().optional(),
  expectedRevision: expectedRevisionSchema.optional(),
  limit: rangeLimitSchema.optional(),
});

export const documentAttributionWireHeaderNames = {
  acceptEncoding: "Accept-Encoding",
  cacheControl: "Cache-Control",
  contentEncoding: "Content-Encoding",
  contentType: "Content-Type",
  etag: "ETag",
  ifNoneMatch: "If-None-Match",
  vary: "Vary",
} as const;

export const documentAttributionWireHeaderKeys = {
  acceptEncoding: "accept-encoding",
  cacheControl: "cache-control",
  contentEncoding: "content-encoding",
  contentType: "content-type",
  etag: "etag",
  ifNoneMatch: "if-none-match",
  vary: "vary",
} as const;

const DocumentAttributionCompressionRequestHeadersSchema = z.looseObject({
  [documentAttributionWireHeaderKeys.acceptEncoding]: z.string().optional(),
});

export const DocumentAttributionRequestHeadersSchema = z.looseObject({
  [documentAttributionWireHeaderKeys.acceptEncoding]: z.string().optional(),
  [documentAttributionWireHeaderKeys.ifNoneMatch]: z.string().optional(),
});

export type DocumentAttributionRequestHeaders = z.infer<
  typeof DocumentAttributionRequestHeadersSchema
>;

const DocumentAttributionResponseHeadersSchema = z.strictObject({
  // Cache metadata can be reordered or extended by HTTP intermediaries. The
  // transport owns caching; literal matching here must not discard valid edits.
  [documentAttributionWireHeaderKeys.cacheControl]: nonEmptyStringSchema,
  [documentAttributionWireHeaderKeys.contentEncoding]: z.string().optional(),
  [documentAttributionWireHeaderKeys.contentType]: nonEmptyStringSchema,
  [documentAttributionWireHeaderKeys.etag]: nonEmptyStringSchema,
  [documentAttributionWireHeaderKeys.vary]: nonEmptyStringSchema,
});

const DocumentAttributionNotModifiedHeadersSchema = z.strictObject({
  [documentAttributionWireHeaderKeys.cacheControl]: nonEmptyStringSchema,
  [documentAttributionWireHeaderKeys.etag]: nonEmptyStringSchema,
  [documentAttributionWireHeaderKeys.vary]: nonEmptyStringSchema,
});

const DocumentAttributionRangesResponseHeadersSchema = z.strictObject({
  [documentAttributionWireHeaderKeys.cacheControl]: nonEmptyStringSchema,
  [documentAttributionWireHeaderKeys.contentEncoding]: z.string().optional(),
  [documentAttributionWireHeaderKeys.contentType]: nonEmptyStringSchema,
  [documentAttributionWireHeaderKeys.vary]: nonEmptyStringSchema,
});

const attributionFailureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

const attributionFailureStatuses = [400, 401, 403, 404, 409, 500] as const;

export const getDocumentAttributionOperation = defineJsonOperation({
  auth: "session",
  emptyResponseStatuses: [304],
  failureResponses: attributionFailureResponses,
  failureStatuses: attributionFailureStatuses,
  headers: DocumentAttributionRequestHeadersSchema,
  id: "documents.attribution.get",
  method: "GET",
  params: DocumentAttributionPathParamsSchema,
  path: "/documents/{documentId}/attribution",
  responseHeaders: {
    200: DocumentAttributionResponseHeadersSchema,
    304: DocumentAttributionNotModifiedHeadersSchema,
  },
  responses: { 200: DocumentEditAttributionResponseSchema },
  runtimeRefinements: documentAttributionResponseRuntimeRefinements,
});

export const listDocumentAttributionRangesOperation = defineJsonOperation({
  auth: "session",
  failureResponses: attributionFailureResponses,
  failureStatuses: attributionFailureStatuses,
  headers: DocumentAttributionCompressionRequestHeadersSchema,
  id: "documents.attribution.ranges.list",
  method: "GET",
  params: DocumentAttributionPathParamsSchema,
  path: "/documents/{documentId}/attribution/ranges",
  query: DocumentAttributionRangesQuerySchema,
  responseHeaders: { 200: DocumentAttributionRangesResponseHeadersSchema },
  responses: { 200: ListDocumentEditAttributionRangesResponseSchema },
  runtimeRefinements: documentAttributionResponseRuntimeRefinements,
});

export type DocumentAttributionPathParams = z.infer<
  typeof DocumentAttributionPathParamsSchema
>;
export type DocumentAttributionRangesQuery = z.infer<
  typeof DocumentAttributionRangesQuerySchema
>;

export const isGetDocumentAttributionOperationResponse =
  isDocumentEditAttributionResponse;
export const isListDocumentAttributionRangesOperationResponse =
  isListDocumentEditAttributionRangesResponse;
