import type { RequestResult } from "@tearleads/api-client";
import type {
  RootOrganizationPageQuery,
  RootOrganizationsQuery,
} from "@tearleads/validators/operation";
import type {
  RootOrganizationDetailResponse,
  RootOrganizationIdentitiesResponse,
  RootOrganizationIdentityResponse,
  RootOrganizationSummaryResponse,
  RootOrganizationsResponse,
} from "@tearleads/validators/response";
import { type RootRequestOutcome, toOutcome } from "./identities";

export type RootOrganization = RootOrganizationSummaryResponse;
export type RootOrganizationsPage = RootOrganizationsResponse;
export type RootOrganizationDetail = RootOrganizationDetailResponse;
export type RootOrganizationIdentity = RootOrganizationIdentityResponse;
export type RootOrganizationIdentitiesPage = RootOrganizationIdentitiesResponse;
export type RootOrganizationsQueryInput = RootOrganizationsQuery;
export type RootOrganizationPageQueryInput = RootOrganizationPageQuery;

export interface RootOrganizationsApi {
  listRootOrganizationsResult(
    query?: RootOrganizationsQuery,
  ): Promise<RequestResult<RootOrganizationsResponse>>;
  getRootOrganizationResult(
    organizationId: string,
  ): Promise<RequestResult<RootOrganizationDetailResponse>>;
  listRootOrganizationIdentitiesResult(
    organizationId: string,
    query?: RootOrganizationPageQuery,
  ): Promise<RequestResult<RootOrganizationIdentitiesResponse>>;
}
export async function listRootOrganizations(
  api: RootOrganizationsApi,
  query: RootOrganizationsQueryInput = {},
): Promise<RootRequestOutcome<RootOrganizationsPage>> {
  return toOutcome(await api.listRootOrganizationsResult(query));
}
export async function loadRootOrganization(
  api: RootOrganizationsApi,
  organizationId: string,
): Promise<RootRequestOutcome<RootOrganizationDetail>> {
  return toOutcome(await api.getRootOrganizationResult(organizationId));
}
export async function listRootOrganizationIdentities(
  api: RootOrganizationsApi,
  organizationId: string,
  query: RootOrganizationPageQueryInput = {},
): Promise<RootRequestOutcome<RootOrganizationIdentitiesPage>> {
  return toOutcome(
    await api.listRootOrganizationIdentitiesResult(organizationId, query),
  );
}
