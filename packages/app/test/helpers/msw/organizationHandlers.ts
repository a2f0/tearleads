import type { OrganizationBillingResponse } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";

export const organizationHandlers = [
  http.get<{ organizationId: string }>(
    "http://localhost:3001/organizations/:organizationId/billing",
    ({ params }) => {
      return HttpResponse.json<OrganizationBillingResponse>({
        organizationId: params.organizationId,
        activeMemberCount: 1,
        assignedSeatCount: 1,
        assignedUserIds: ["user-1"],
        currentUserHasSyncSeat: true,
        status: "trialing",
        trialEndsAt: "2099-01-01T00:00:00.000Z",
        provider: null,
        canCancelDirectly: false,
        subscriptionSource: null,
        currentPeriodStartsAt: null,
        currentPeriodEndsAt: null,
        seatCount: 1,
        pendingSeatCount: null,
        disabledAt: null,
        purgeAfter: null,
      });
    },
  ),
  // Connect-time membership refresh: no organization is paused by default.
  http.get("http://localhost:3001/organization-memberships", () =>
    HttpResponse.json({ memberships: [] }),
  ),
];
