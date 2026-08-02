/** Provider state could not be verified because of a transient dependency. */
export class OrganizationBillingProviderUnavailableError extends Error {
  readonly status = 503 as const;
}
