import type { RequestResult } from "@tearleads/api-client";
import type {
  OrganizationDataUsageResponse,
  RootDataUsageReportResponse,
} from "@tearleads/validators/response";
import { type RootRequestOutcome, toOutcome } from "./identities";
import type { RootOrganizationsQueryInput } from "./organizations";

export type RootDataUsageReportPage = RootDataUsageReportResponse;
export interface RootDataUsageApi {
  getRootOrganizationDataUsageResult(
    organizationId: string,
  ): Promise<RequestResult<OrganizationDataUsageResponse>>;
  listRootDataUsageReportResult(
    query?: RootOrganizationsQueryInput,
  ): Promise<RequestResult<RootDataUsageReportResponse>>;
}
export async function loadRootOrganizationDataUsage(
  api: RootDataUsageApi,
  organizationId: string,
): Promise<RootRequestOutcome<OrganizationDataUsageResponse>> {
  return toOutcome(
    await api.getRootOrganizationDataUsageResult(organizationId),
  );
}
export async function listRootDataUsageReport(
  api: RootDataUsageApi,
  query: RootOrganizationsQueryInput = {},
): Promise<RootRequestOutcome<RootDataUsageReportPage>> {
  return toOutcome(await api.listRootDataUsageReportResult(query));
}
