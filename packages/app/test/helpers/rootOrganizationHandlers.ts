import type {
  OrganizationDataUsageResponse,
  RootDataUsageReportResponse,
  RootOrganizationIdentitiesResponse,
  RootOrganizationsResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  ROOT_TEST_IDENTITIES,
  ROOT_TEST_ORGANIZATION,
} from "./rootConsoleFixtures";

const usage: OrganizationDataUsageResponse = {
  organizationId: ROOT_TEST_ORGANIZATION.organization.organizationId,
  blobs: { blobCount: 2, byteLength: 2048 },
  documents: {
    breakdown: [
      {
        category: "containerMetadata",
        byteLength: 128,
        documentCount: 1,
        updateCount: 1,
      },
      {
        category: "rosterProfiles",
        byteLength: 0,
        documentCount: 0,
        updateCount: 0,
      },
      {
        category: "organizationMetadata",
        byteLength: 0,
        documentCount: 0,
        updateCount: 0,
      },
      { category: "user", byteLength: 384, documentCount: 1, updateCount: 3 },
    ],
    byteLength: 512,
    documentCount: 2,
    updateCount: 4,
  },
  totalByteLength: 2560,
};
export const rootOrganizationHandlers = [
  http.get(
    "http://localhost:3001/root/organizations/:organizationId/data-usage",
    () => HttpResponse.json(usage),
  ),
  http.get("http://localhost:3001/root/reports/data-usage", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const organization = ROOT_TEST_ORGANIZATION.organization;
    if (query.get("search") === "missing")
      return HttpResponse.json<RootDataUsageReportResponse>({
        organizations: [],
        nextCursor: null,
      });
    if (query.has("cursor"))
      return HttpResponse.json<RootDataUsageReportResponse>({
        organizations: [
          {
            organization: {
              ...organization,
              name: "Empty Org",
              organizationId: "55555555-5555-4555-8555-555555555555",
            },
            dataUsage: {
              ...usage,
              organizationId: "55555555-5555-4555-8555-555555555555",
              blobs: { blobCount: 0, byteLength: 0 },
              documents: {
                breakdown: usage.documents.breakdown.map((entry) => ({
                  ...entry,
                  byteLength: 0,
                  documentCount: 0,
                  updateCount: 0,
                })),
                byteLength: 0,
                documentCount: 0,
                updateCount: 0,
              },
              totalByteLength: 0,
            },
          },
        ],
        nextCursor: null,
      });
    return HttpResponse.json<RootDataUsageReportResponse>({
      organizations: [{ organization, dataUsage: usage }],
      nextCursor: "usage-page-2",
    });
  }),
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
