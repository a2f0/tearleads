import type {
  RootOrganizationIdentitiesResponse,
  RootOrganizationsResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  ROOT_TEST_IDENTITIES,
  ROOT_TEST_ORGANIZATION,
} from "./rootConsoleFixtures";

export const rootOrganizationHandlers = [
  http.get("http://localhost:3001/root/organizations", ({ request }) => {
    const search =
      new URL(request.url).searchParams.get("search")?.toLowerCase() ?? "";
    const org = ROOT_TEST_ORGANIZATION.organization;
    return HttpResponse.json<RootOrganizationsResponse>({
      organizations:
        org.name.toLowerCase().includes(search) || search === org.organizationId
          ? [org]
          : [],
      nextCursor: null,
    });
  }),
  http.get<{ organizationId: string }>(
    "http://localhost:3001/root/organizations/:organizationId",
    ({ params }) =>
      params.organizationId ===
      ROOT_TEST_ORGANIZATION.organization.organizationId
        ? HttpResponse.json(ROOT_TEST_ORGANIZATION)
        : HttpResponse.json(
            { error: "Organization not found" },
            { status: 404 },
          ),
  ),
  http.get<{ organizationId: string }>(
    "http://localhost:3001/root/organizations/:organizationId/identities",
    ({ params }) =>
      HttpResponse.json<RootOrganizationIdentitiesResponse>({
        identities: ROOT_TEST_IDENTITIES.filter(
          (identity) =>
            identity.defaultOrganizationId === params.organizationId,
        ).map((identity) => ({
          identity,
          roster: {
            status: "active",
            joinedAt: "2026-08-01T00:00:00.000Z",
            disabledAt: null,
          },
        })),
        nextCursor: null,
      }),
  ),
];
