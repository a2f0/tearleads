import type { RequestResult } from "@tearleads/api-client";
import type {
  RootRevenuecatEventsQuery,
  RootRevenuecatEventsReportQuery,
} from "@tearleads/validators/operation";
import type {
  RootOrganizationRevenuecatEventResponse,
  RootOrganizationRevenuecatEventsResponse,
  RootRevenuecatEventResponse,
  RootRevenuecatEventsReportResponse,
} from "@tearleads/validators/response";
import { type RootRequestOutcome, toOutcome } from "./identities";

/** One stored RevenueCat webhook delivery (wire shape). */
export type RootRevenuecatEvent = RootRevenuecatEventResponse;

/** A delivery as one organization saw it: applied to it, or moved from it. */
export type RootOrganizationRevenuecatEvent =
  RootOrganizationRevenuecatEventResponse;

/** A page of an organization's deliveries, newest first. */
export type RootOrganizationRevenuecatEventsPage =
  RootOrganizationRevenuecatEventsResponse;

/** A page of unmatched or ignored deliveries, newest first. */
export type RootRevenuecatEventsReportPage = RootRevenuecatEventsReportResponse;

export type RootRevenuecatEventsQueryInput = RootRevenuecatEventsQuery;

/** Paging and which dispositions to list (both when omitted). */
export type RootRevenuecatEventsReportQueryInput =
  RootRevenuecatEventsReportQuery;

export interface RootRevenuecatApi {
  listRootOrganizationRevenuecatEventsResult(
    organizationId: string,
    query?: RootRevenuecatEventsQuery,
  ): Promise<RequestResult<RootOrganizationRevenuecatEventsResponse>>;
  listRootRevenuecatEventsReportResult(
    query?: RootRevenuecatEventsReportQuery,
  ): Promise<RequestResult<RootRevenuecatEventsReportResponse>>;
}

export async function listRootOrganizationRevenuecatEvents(
  api: RootRevenuecatApi,
  organizationId: string,
  query: RootRevenuecatEventsQueryInput = {},
): Promise<RootRequestOutcome<RootOrganizationRevenuecatEventsPage>> {
  return toOutcome(
    await api.listRootOrganizationRevenuecatEventsResult(organizationId, query),
  );
}

export async function listRootRevenuecatEventsReport(
  api: RootRevenuecatApi,
  query: RootRevenuecatEventsReportQueryInput = {},
): Promise<RootRequestOutcome<RootRevenuecatEventsReportPage>> {
  return toOutcome(await api.listRootRevenuecatEventsReportResult(query));
}
