import type {
  RootIdentitiesResponse,
  RootIdentityDetailResponse,
  RootIdentityOrganizationsResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { rootAuditHandlers } from "./rootAuditHandlers";
import { ROOT_TEST_IDENTITIES } from "./rootConsoleFixtures";
import { rootOrganizationHandlers } from "./rootOrganizationHandlers";
import {
  rootSuspensionHandlers,
  withRootTestSuspension,
} from "./rootSuspensionHandlers";

export const rootConsoleHandlers = [
  http.get("http://localhost:3001/root/identities", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const fingerprintPrefix = query.get("fingerprint");
    const userId = query.get("userId");
    const rootOnly = query.get("rootOnly") === "true";
    const identities = ROOT_TEST_IDENTITIES.filter(
      (identity) =>
        (fingerprintPrefix === null ||
          identity.signingKeyFingerprint.startsWith(fingerprintPrefix)) &&
        (userId === null || identity.userId === userId) &&
        (!rootOnly || identity.isRoot),
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
        identity: withRootTestSuspension(identity),
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

            organizationId: identity.defaultOrganizationId,
            roster: {
              disabledAt: null,
              holdsSeat: true,
              joinedAt: "2026-08-01T00:00:00.000Z",
              status: "active",
              syncPausedAt: null,
            },
          },
        ],
      });
    },
  ),
  ...rootOrganizationHandlers,
  ...rootAuditHandlers,
  ...rootSuspensionHandlers,
];
