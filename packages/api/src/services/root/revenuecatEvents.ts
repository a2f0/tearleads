import type {
  RootRevenuecatEventsQuery,
  RootRevenuecatEventsReportQuery,
} from "@tearleads/validators/operation";
import type {
  RootOrganizationRevenuecatEventsResponse,
  RootRevenuecatEventsReportResponse,
} from "@tearleads/validators/response";
import {
  listRootOrganizationRevenuecatEvents,
  listRootRevenuecatEventsReport,
} from "../../workflows/root/revenuecatEvents";
import type { ApiServiceRuntime } from "../runtime";
import { nextCursor, pageInput } from "./organizations";

/**
 * Cursors are scoped to their listing (one organization, or one report
 * disposition), so a cursor from another listing is refused instead of
 * positioning this one.
 */
export async function listOrganizationRevenuecatEvents(
  runtime: ApiServiceRuntime,
  organizationId: string,
  query: RootRevenuecatEventsQuery,
): Promise<RootOrganizationRevenuecatEventsResponse> {
  const scope = `revenuecatEvents:${organizationId}`;
  const result = await listRootOrganizationRevenuecatEvents(runtime.db, {
    ...pageInput(query, scope),
    organizationId,
  });
  return {
    events: result.events,
    nextCursor: nextCursor(result.nextAfterId, scope),
  };
}

export async function listRevenuecatEventsReport(
  runtime: ApiServiceRuntime,
  query: RootRevenuecatEventsReportQuery,
): Promise<RootRevenuecatEventsReportResponse> {
  const disposition = query.disposition ?? "both";
  const scope = `revenuecatReport:${disposition}`;
  const result = await listRootRevenuecatEventsReport(runtime.db, {
    ...pageInput(query, scope),
    disposition,
  });
  return {
    events: result.events,
    nextCursor: nextCursor(result.nextAfterId, scope),
  };
}
