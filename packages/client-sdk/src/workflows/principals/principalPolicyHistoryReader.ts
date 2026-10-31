import type { ApiClient } from "@tearleads/api-client";

/**
 * Where recovery reads signed principal policy history. The API client is the
 * production reader; registration reads a just-provisioned principal from its
 * local bundles, and directory discovery replays a page it already fetched.
 * Every page is untrusted input to the same verifier, whichever reader
 * supplied it.
 */
export interface PrincipalPolicyHistoryReader {
  readonly getPrincipalPolicyPages: ApiClient["getPrincipalPolicyPages"];
  readonly getProjectionPolicyHistoryPages: ApiClient["getProjectionPolicyHistoryPages"];
  /**
   * Conditional unpinned discovery. Readers that replay local or already
   * fetched pages omit it, so discovery reads their first page instead.
   */
  readonly getPrincipalPolicyDiscovery?:
    | ApiClient["getPrincipalPolicyDiscovery"]
    | undefined;
}

/** Reads one principal's own policy history. */
export type PrincipalPolicyPageReader = Pick<
  PrincipalPolicyHistoryReader,
  "getPrincipalPolicyPages" | "getPrincipalPolicyDiscovery"
>;

/** Reads an organization's public projection policy history. */
export type ProjectionPolicyHistoryReader = Pick<
  PrincipalPolicyHistoryReader,
  "getProjectionPolicyHistoryPages"
>;

/** The API client as a page reader, or undefined when this client has none. */
export function apiPrincipalPolicyPageReader(
  apiClient: Partial<PrincipalPolicyPageReader>,
): PrincipalPolicyPageReader | undefined {
  const getPrincipalPolicyPages =
    apiClient.getPrincipalPolicyPages?.bind(apiClient);
  const getPrincipalPolicyDiscovery =
    apiClient.getPrincipalPolicyDiscovery?.bind(apiClient);
  return getPrincipalPolicyPages
    ? { getPrincipalPolicyPages, getPrincipalPolicyDiscovery }
    : undefined;
}

/** The API client as a projection reader, or undefined when it has none. */
export function apiProjectionPolicyHistoryReader(
  apiClient: Partial<ProjectionPolicyHistoryReader>,
): ProjectionPolicyHistoryReader | undefined {
  const getProjectionPolicyHistoryPages =
    apiClient.getProjectionPolicyHistoryPages?.bind(apiClient);
  return getProjectionPolicyHistoryPages
    ? { getProjectionPolicyHistoryPages }
    : undefined;
}
