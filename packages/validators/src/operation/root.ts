import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  ErrorResponseSchema,
  isRootIdentitiesResponse,
  isRootIdentityDetailResponse,
  isRootIdentityOrganizationsResponse,
  RootIdentitiesResponseSchema,
  RootIdentityDetailResponseSchema,
  RootIdentityOrganizationsResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import {
  loosePlainObject,
  sha256HexStringSchema,
  uuidV4StringSchema,
} from "../schema";
import { defineJsonOperation } from "./definition";

export const MAX_ROOT_IDENTITY_PAGE_SIZE = 200;

const DIGITS_PATTERN = /^\d+$/u;

// Query values arrive as strings over HTTP and as numbers from typed clients;
// both are accepted, and the OpenAPI view stays a bounded integer.
function rootIdentityPageLimitSchema() {
  return registerJsonSchemaFragment(
    z.union([z.number(), z.string()]).superRefine((value, context) => {
      if (typeof value === "string" && !DIGITS_PATTERN.test(value)) {
        context.addIssue({ code: "custom", message: "Invalid limit" });
        return;
      }
      const parsed = Number(value);
      if (
        !Number.isSafeInteger(parsed) ||
        parsed < 1 ||
        parsed > MAX_ROOT_IDENTITY_PAGE_SIZE
      ) {
        context.addIssue({ code: "custom", message: "Invalid limit" });
      }
    }),
    { maximum: MAX_ROOT_IDENTITY_PAGE_SIZE, minimum: 1, type: "integer" },
  );
}

const RootPathParamsSchema = z.strictObject({});
export const RootIdentityPathParamsSchema = z.strictObject({
  userId: uuidV4StringSchema,
});
export type RootIdentityPathParams = z.infer<
  typeof RootIdentityPathParamsSchema
>;

export const RootIdentitiesQuerySchema = loosePlainObject({
  cursor: z.string().min(1).optional(),
  fingerprint: sha256HexStringSchema.optional(),
  limit: rootIdentityPageLimitSchema().optional(),
});
export type RootIdentitiesQuery = z.infer<typeof RootIdentitiesQuerySchema>;

const rootFailureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

export const listRootIdentitiesOperation = defineJsonOperation({
  auth: "session",
  failureResponses: rootFailureResponses,
  failureStatuses: [400, 401, 403, 500],
  id: "root.identities.list",
  method: "GET",
  params: RootPathParamsSchema,
  path: "/root/identities",
  query: RootIdentitiesQuerySchema,
  responses: {
    200: RootIdentitiesResponseSchema,
  },
});

export const getRootIdentityOperation = defineJsonOperation({
  auth: "session",
  failureResponses: { ...rootFailureResponses, 404: ErrorResponseSchema },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "root.identities.get",
  method: "GET",
  params: RootIdentityPathParamsSchema,
  path: "/root/identities/{userId}",
  responses: {
    200: RootIdentityDetailResponseSchema,
  },
});

export const listRootIdentityOrganizationsOperation = defineJsonOperation({
  auth: "session",
  failureResponses: { ...rootFailureResponses, 404: ErrorResponseSchema },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "root.identities.organizations.list",
  method: "GET",
  params: RootIdentityPathParamsSchema,
  path: "/root/identities/{userId}/organizations",
  responses: {
    200: RootIdentityOrganizationsResponseSchema,
  },
});

export const isListRootIdentitiesOperationResponse = isRootIdentitiesResponse;
export const isGetRootIdentityOperationResponse = isRootIdentityDetailResponse;
export const isListRootIdentityOrganizationsOperationResponse =
  isRootIdentityOrganizationsResponse;
