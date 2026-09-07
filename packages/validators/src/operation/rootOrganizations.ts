import { z } from "zod";
import { organizationDataUsageResponseRuntimeRefinements } from "../organizationDataUsageRefinements";
import {
  ErrorResponseSchema,
  OrganizationDataUsageResponseSchema,
  RootDataUsageReportResponseSchema,
  RootOrganizationDetailResponseSchema,
  RootOrganizationIdentitiesResponseSchema,
  RootOrganizationsResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import {
  boundedStringSchema,
  loosePlainObject,
  uuidV4StringSchema,
} from "../schema";
import { defineJsonOperation } from "./definition";
import { rootIdentityPageLimitSchema } from "./root";

const pageShape = {
  cursor: z.string().min(1).optional(),
  limit: rootIdentityPageLimitSchema().optional(),
};
const RootOrganizationPageQuerySchema = loosePlainObject(pageShape);
export type RootOrganizationPageQuery = z.infer<
  typeof RootOrganizationPageQuerySchema
>;
const RootOrganizationsQuerySchema = loosePlainObject({
  ...pageShape,
  search: boundedStringSchema(200).optional(),
});
export type RootOrganizationsQuery = z.infer<
  typeof RootOrganizationsQuerySchema
>;
const RootOrganizationParamsSchema = z.strictObject({
  organizationId: uuidV4StringSchema,
});
const failureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

export const listRootOrganizationsOperation = defineJsonOperation({
  auth: "session",
  failureResponses,
  failureStatuses: [400, 401, 403, 404, 500],
  id: "root.organizations.list",
  method: "GET",
  params: z.strictObject({}),
  path: "/root/organizations",
  query: RootOrganizationsQuerySchema,
  responses: { 200: RootOrganizationsResponseSchema },
});
export const getRootOrganizationOperation = defineJsonOperation({
  auth: "session",
  failureResponses,
  failureStatuses: [400, 401, 403, 404, 500],
  id: "root.organizations.get",
  method: "GET",
  params: RootOrganizationParamsSchema,
  path: "/root/organizations/{organizationId}",
  responses: { 200: RootOrganizationDetailResponseSchema },
});
export const listRootOrganizationIdentitiesOperation = defineJsonOperation({
  auth: "session",
  failureResponses,
  failureStatuses: [400, 401, 403, 404, 500],
  id: "root.organizations.identities.list",
  method: "GET",
  params: RootOrganizationParamsSchema,
  path: "/root/organizations/{organizationId}/identities",
  query: RootOrganizationPageQuerySchema,
  responses: { 200: RootOrganizationIdentitiesResponseSchema },
});

export const getRootOrganizationDataUsageOperation = defineJsonOperation({
  auth: "session",
  failureResponses,
  failureStatuses: [400, 401, 403, 404, 500],
  id: "root.organizations.dataUsage.get",
  method: "GET",
  params: RootOrganizationParamsSchema,
  path: "/root/organizations/{organizationId}/data-usage",
  responses: { 200: OrganizationDataUsageResponseSchema },
  runtimeRefinements: organizationDataUsageResponseRuntimeRefinements,
});
export const listRootDataUsageReportOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 500],
  id: "root.reports.dataUsage.list",
  method: "GET",
  params: z.strictObject({}),
  path: "/root/reports/data-usage",
  query: RootOrganizationsQuerySchema,
  responses: { 200: RootDataUsageReportResponseSchema },
  runtimeRefinements: organizationDataUsageResponseRuntimeRefinements,
});
