import { expect } from "bun:test";
import { ORGANIZATION_DOCUMENT_USAGE_CATEGORIES } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const organizationId = "11111111-1111-4111-8111-111111111111";
const organization = {
  organizationId,
  name: "Organization A",
  createdAt: "2026-08-01T00:00:00.000Z",
  billingStatus: null,
};

testApiClient(
  "root organization transport encodes filters and decodes detail and roster",
  async () => {
    const paths: string[] = [];
    server.use(
      http.get(`${apiBaseUrl}/root/organizations`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("search")).toBe("A & B%");
        expect(query.get("limit")).toBe("1");
        return HttpResponse.json({
          organizations: [organization],
          nextCursor: "opaque",
        });
      }),
      http.get(
        `${apiBaseUrl}/root/organizations/:organizationId`,
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          return HttpResponse.json({
            organization,
            billing: null,
            stripe: null,
            history: [],
          });
        },
      ),
      http.get(
        `${apiBaseUrl}/root/organizations/:organizationId/identities`,
        ({ request }) => {
          paths.push(new URL(request.url).pathname);
          expect(new URL(request.url).searchParams.get("cursor")).toBe(
            "opaque",
          );
          return HttpResponse.json({ identities: [], nextCursor: null });
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.listRootOrganizationsResult({ search: "A & B%", limit: 1 }),
    ).toEqual({
      ok: true,
      data: { organizations: [organization], nextCursor: "opaque" },
    });
    expect(await client.getRootOrganizationResult(organizationId)).toEqual({
      ok: true,
      data: { organization, billing: null, stripe: null, history: [] },
    });
    expect(
      await client.listRootOrganizationIdentitiesResult(organizationId, {
        cursor: "opaque",
      }),
    ).toEqual({ ok: true, data: { identities: [], nextCursor: null } });
    expect(paths).toEqual([
      `/root/organizations/${organizationId}`,
      `/root/organizations/${organizationId}/identities`,
    ]);
  },
);

testApiClient(
  "root organization transport rejects malformed billing and invalid IDs",
  async () => {
    let requests = 0;
    server.use(
      http.get(`${apiBaseUrl}/root/organizations/:organizationId`, () => {
        requests += 1;
        return HttpResponse.json({
          organization,
          billing: { status: "active" },
          stripe: null,
          history: [],
        });
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    expect((await client.getRootOrganizationResult(organizationId)).ok).toBe(
      false,
    );
    await expect(client.getRootOrganizationResult("bad-id")).rejects.toThrow();
    expect(requests).toBe(1);
  },
);

testApiClient(
  "root usage transport checks query encoding and rejects inconsistent totals",
  async () => {
    const usage = {
      organizationId,
      blobs: { blobCount: 0, byteLength: 0 },
      documents: {
        breakdown: ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.map((category) => ({
          category,
          byteLength: 0,
          documentCount: 0,
          updateCount: 0,
        })),
        byteLength: 0,
        documentCount: 0,
        updateCount: 0,
      },
      totalByteLength: 0,
    };
    let invalidTotal = false;
    server.use(
      http.get<{ organizationId: string }>(
        `${apiBaseUrl}/root/organizations/:organizationId/data-usage`,
        ({ params }) => {
          expect(params.organizationId).toBe(organizationId);
          return HttpResponse.json({
            ...usage,
            totalByteLength: invalidTotal ? 1 : 0,
          });
        },
      ),
      http.get(`${apiBaseUrl}/root/reports/data-usage`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("search")).toBe("A & B%");
        expect(query.get("cursor")).toBe("opaque");
        return HttpResponse.json({
          organizations: [
            {
              organization,
              dataUsage: { ...usage, totalByteLength: invalidTotal ? 1 : 0 },
            },
          ],
          nextCursor: null,
        });
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    const report = () =>
      client.listRootDataUsageReportResult({
        search: "A & B%",
        cursor: "opaque",
        limit: 2,
      });
    expect(
      await client.getRootOrganizationDataUsageResult(organizationId),
    ).toEqual({ ok: true, data: usage });
    expect((await report()).ok).toBe(true);
    invalidTotal = true;
    expect(
      (await client.getRootOrganizationDataUsageResult(organizationId)).ok,
    ).toBe(false);
    expect((await report()).ok).toBe(false);
  },
);
