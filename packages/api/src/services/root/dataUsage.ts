import type { RootOrganizationsQuery } from "@tearleads/validators/operation";
import type {
  OrganizationDataUsageResponse,
  RootDataUsageReportResponse,
} from "@tearleads/validators/response";
import {
  loadRootDataUsageReport,
  loadRootOrganizationDataUsage,
} from "../../workflows/root/dataUsage";
import type { ApiServiceRuntime } from "../runtime";
import {
  nextCursor,
  organizationListInput,
  RootOrganizationError,
} from "./organizations";

export async function getOrganizationDataUsage(
  runtime: ApiServiceRuntime,
  organizationId: string,
): Promise<OrganizationDataUsageResponse> {
  const usage = await loadRootOrganizationDataUsage(runtime.db, organizationId);
  if (!usage) throw new RootOrganizationError("Organization not found", 404);
  return usage;
}
export async function listDataUsageReport(
  runtime: ApiServiceRuntime,
  query: RootOrganizationsQuery,
): Promise<RootDataUsageReportResponse> {
  const { scope, input } = organizationListInput(query, "data-usage-report");
  const report = await loadRootDataUsageReport(runtime.db, input);
  return {
    organizations: report.organizations,
    nextCursor: nextCursor(report.nextAfterId, scope),
  };
}
