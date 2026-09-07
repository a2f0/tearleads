import type {
  RootIdentitiesResponse,
  RootIdentityDetailResponse,
  RootIdentityOrganizationsResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { ROOT_TEST_IDENTITIES } from "./rootConsoleFixtures";
import { rootOrganizationHandlers } from "./rootOrganizationHandlers";

export const rootConsoleHandlers = [
  http.get("http://localhost:3001/root/identities", ({ request }) => {
    const fingerprint = new URL(request.url).searchParams.get("fingerprint");
    const identities = ROOT_TEST_IDENTITIES.filter(
      (identity) =>
        fingerprint === null || identity.signingKeyFingerprint === fingerprint,
    );
    return HttpResponse.json<RootIdentitiesResponse>({
      identities,
      nextCursor: null,
    });
  }),
  http.get<{ userId: string }>(
    "http://localhost:3001/root/identities/:userId",
    ({ params }) => {
      const identity = ROOT_TEST_IDENTITIES.find(
        (candidate) => candidate.userId === params.userId,
      );
      if (!identity) {
        return HttpResponse.json({ error: "User not found" }, { status: 404 });
      }
      return HttpResponse.json<RootIdentityDetailResponse>({
        identity,
        sessions: [
          {
            createdAt: "2026-09-01T09:00:00.000Z",
            id: "e".repeat(64),
            ipAddresses: ["203.0.113.7"],
            lastActiveAt: "2026-09-06T10:00:00.000Z",
            lastActiveIp: "203.0.113.7",
            signingKeyFingerprint: identity.signingKeyFingerprint,
          },
        ],
      });
    },
  ),
  http.get<{ userId: string }>(
    "http://localhost:3001/root/identities/:userId/organizations",
    ({ params }) => {
      const identity = ROOT_TEST_IDENTITIES.find(
        (candidate) => candidate.userId === params.userId,
      );
      if (!identity) {
        return HttpResponse.json({ error: "User not found" }, { status: 404 });
      }
      return HttpResponse.json<RootIdentityOrganizationsResponse>({
        organizations: [
          {
            billing: {
              currentPeriodEndsAt: null,
              disabledAt: null,
              provider: null,
              purgeAfter: null,
              purgedAt: null,
              seatCount: 1,
              status: "trialing",
              trialEndsAt: "2099-01-01T00:00:00.000Z",
            },
            createdAt: "2026-08-01T00:00:00.000Z",
            isDefaultOrganization: true,
            name: "Root Test Org",
            organizationId: identity.defaultOrganizationId,
            roster: {
              disabledAt: null,
              joinedAt: "2026-08-01T00:00:00.000Z",
              status: "active",
            },
          },
        ],
      });
    },
  ),
  ...rootOrganizationHandlers,
];
