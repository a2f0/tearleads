import { z } from "zod";
import {
  ErrorResponseSchema,
  RootOrganizationRevenuecatEventsResponseSchema,
  RootRevenuecatDispositionSchema,
  RootRevenuecatEventsReportResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { loosePlainObject, uuidV4StringSchema } from "../schema";
import { defineJsonOperation } from "./definition";
import { rootIdentityPageLimitSchema } from "./root";

const pageShape = {
  cursor: z.string().min(1).optional(),
  limit: rootIdentityPageLimitSchema().optional(),
};
const RootRevenuecatEventsQuerySchema = loosePlainObject(pageShape);
export type RootRevenuecatEventsQuery = z.infer<
  typeof RootRevenuecatEventsQuerySchema
>;
const RootRevenuecatEventsReportQuerySchema = loosePlainObject({
  ...pageShape,
  /** Which deliveries to list; both when omitted. */
  disposition: RootRevenuecatDispositionSchema.optional(),
});
export type RootRevenuecatEventsReportQuery = z.infer<
  typeof RootRevenuecatEventsReportQuerySchema
>;
const failureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

/**
 * An organization's stored RevenueCat webhook deliveries, newest first: the
 * ones applied to it and the transfers that moved a purchase away from it.
 */
export const listRootOrganizationRevenuecatEventsOperation =
  defineJsonOperation({
    auth: "session",
    failureResponses,
    failureStatuses: [400, 401, 403, 500],
    id: "root.organizations.revenuecatEvents.list",
    method: "GET",
    params: z.strictObject({ organizationId: uuidV4StringSchema }),
    path: "/root/organizations/{organizationId}/revenuecat-events",
    query: RootRevenuecatEventsQuerySchema,
    responses: { 200: RootOrganizationRevenuecatEventsResponseSchema },
  });

/**
 * Deliveries across every organization that resolved to none, or that the
 * handler ignored, newest first.
 */
export const listRootRevenuecatEventsReportOperation = defineJsonOperation({
  auth: "session",
  failureResponses,
  failureStatuses: [400, 401, 403, 500],
  id: "root.reports.revenuecatEvents.list",
  method: "GET",
  params: z.strictObject({}),
  path: "/root/reports/revenuecat-events",
  query: RootRevenuecatEventsReportQuerySchema,
  responses: { 200: RootRevenuecatEventsReportResponseSchema },
});
