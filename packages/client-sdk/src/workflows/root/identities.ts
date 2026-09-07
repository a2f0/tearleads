import type { RequestResult } from "@tearleads/api-client";
import type { RootIdentitiesQuery } from "@tearleads/validators/operation";
import type {
  RootIdentitiesResponse,
  RootIdentityDetailResponse,
  RootIdentityOrganizationResponse,
  RootIdentityOrganizationsResponse,
  RootIdentitySessionResponse,
  RootIdentitySummaryResponse,
} from "@tearleads/validators/response";

/** One registered identity as the platform operator sees it (wire shape). */
export type RootIdentity = RootIdentitySummaryResponse;

/** A page of identities plus the opaque cursor for the next page. */
export type RootIdentitiesPage = RootIdentitiesResponse;

/** A live session of an inspected identity (wire shape). */
export type RootIdentitySession = RootIdentitySessionResponse;

/** An identity with its live sessions (wire shape). */
export type RootIdentityDetail = RootIdentityDetailResponse;

/** One organization the identity belongs to, with roster and billing state. */
export type RootIdentityOrganization = RootIdentityOrganizationResponse;

/** Listing filters and paging for `listRootIdentities`. */
export type RootIdentitiesQueryInput = RootIdentitiesQuery;

/**
 * Terminal outcome of a root request. Failures carry the HTTP status when one
 * was received (403 means the session is no longer root) and a message that
 * is safe to surface to the operator.
 */
export type RootRequestOutcome<Data> =
  | { readonly data: Data; readonly ok: true }
  | {
      readonly message: string;
      readonly ok: false;
      readonly status: number | null;
    };

/** The root methods these workflows need from the api client. */
export interface RootIdentitiesApi {
  readonly getRootIdentityResult: (
    userId: string,
  ) => Promise<RequestResult<RootIdentityDetailResponse>>;
  readonly listRootIdentitiesResult: (
    query?: RootIdentitiesQuery,
  ) => Promise<RequestResult<RootIdentitiesResponse>>;
  readonly listRootIdentityOrganizationsResult: (
    userId: string,
  ) => Promise<RequestResult<RootIdentityOrganizationsResponse>>;
}

function toOutcome<Data>(
  result: RequestResult<Data>,
): RootRequestOutcome<Data> {
  if (result.ok) {
    return { data: result.data, ok: true };
  }
  return { message: result.message, ok: false, status: result.status };
}

export async function listRootIdentities(
  api: RootIdentitiesApi,
  query: RootIdentitiesQueryInput = {},
): Promise<RootRequestOutcome<RootIdentitiesPage>> {
  return toOutcome(await api.listRootIdentitiesResult(query));
}

export async function loadRootIdentity(
  api: RootIdentitiesApi,
  userId: string,
): Promise<RootRequestOutcome<RootIdentityDetail>> {
  return toOutcome(await api.getRootIdentityResult(userId));
}

export async function listRootIdentityOrganizations(
  api: RootIdentitiesApi,
  userId: string,
): Promise<RootRequestOutcome<RootIdentityOrganization[]>> {
  const result = await api.listRootIdentityOrganizationsResult(userId);
  return result.ok
    ? { data: result.data.organizations, ok: true }
    : toOutcome(result);
}
