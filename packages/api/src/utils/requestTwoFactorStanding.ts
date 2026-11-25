import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What the authenticated session says about two-factor sign-in: whether it
 * passed a second factor, and which organizations, when it was opened,
 * required one of this member. A change to a member's requirement revokes
 * their sessions that did not pass one, so the next sign-in reads it again.
 */
interface RequestTwoFactorStanding {
  readonly requiredOrganizationIds: ReadonlySet<string>;
  readonly verified: boolean;
}

const standings = new AsyncLocalStorage<RequestTwoFactorStanding>();

/** Authentication installs the session's standing around the request. */
export function withRequestTwoFactorStanding<T>(
  session: {
    readonly twoFactorRequiredOrganizationIds: readonly string[];
    readonly twoFactorVerified: boolean;
  },
  work: () => T,
): T {
  return standings.run(
    {
      requiredOrganizationIds: new Set(
        session.twoFactorRequiredOrganizationIds,
      ),
      verified: session.twoFactorVerified,
    },
    work,
  );
}

/**
 * Refused because an administrator requires two-factor sign-in of this
 * member and the session did not pass it. A 403 with its own code, never the
 * organization access denial, so clients keep the organization's local data.
 */
export class OrganizationTwoFactorRequiredError extends Error {
  readonly status = 403 as const;

  constructor(readonly organizationId: string) {
    super(
      "This organization requires two-factor authentication. Turn it on, then sign in again.",
    );
    this.name = "OrganizationTwoFactorRequiredError";
  }
}

/**
 * Gates an organization-scoped request on the member's two-factor
 * requirement. Work outside an authenticated request (the realtime gateway's
 * interest checks, scheduled maintenance) has no session standing and is not
 * gated here.
 */
export function assertOrganizationTwoFactorStanding(
  organizationId: string,
): void {
  const standing = standings.getStore();
  if (
    !standing ||
    standing.verified ||
    !standing.requiredOrganizationIds.has(organizationId)
  ) {
    return;
  }
  throw new OrganizationTwoFactorRequiredError(organizationId);
}
