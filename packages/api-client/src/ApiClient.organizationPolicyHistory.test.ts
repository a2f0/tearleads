import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient(
  "organization history requests preserve the exact head and validate evidence",
  async () => {
    const organizationId = crypto.randomUUID();
    const stateHash = "state+/=hash";
    let requested = "";
    server.use(
      http.get(
        `${apiBaseUrl}/organizations/:organizationId/policy-history`,
        ({ request }) => {
          requested = request.url;
          return HttpResponse.json({
            organizationId,
            stateHash,
            beforeVersion: 2,
            nextBeforeVersion: null,
            evidence: {
              organization: null,
              organizationPayloads: [],
              groups: [],
            },
          });
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.getOrganizationPolicyHistoryResult(
        organizationId,
        stateHash,
      ),
    ).toMatchObject({ ok: true, data: { organizationId, stateHash } });
    expect(new URL(requested).searchParams.get("stateHash")).toBe(stateHash);
    server.use(
      http.get(
        `${apiBaseUrl}/organizations/:organizationId/policy-history`,
        () => HttpResponse.json({ organizationId, stateHash }),
      ),
    );
    expect(
      (
        await client.getOrganizationPolicyHistoryResult(
          organizationId,
          stateHash,
          { reportErrors: false },
        )
      ).ok,
    ).toBe(false);
  },
);

testApiClient(
  "organization pages retry only validated preparation with the same head and cursor",
  async () => {
    const organizationId = crypto.randomUUID();
    const urls: string[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/organizations/:organizationId/policy-history`,
        ({ request }) => {
          urls.push(request.url);
          if (urls.length === 1)
            return HttpResponse.json(
              {
                code: "principal_history_preparation_pending",
                committed: false,
                progressToken: "a".repeat(64),
              },
              { status: 202 },
            );
          return HttpResponse.json({
            organizationId,
            stateHash: "head",
            beforeVersion: 34,
            nextBeforeVersion: 2,
            evidence: {
              organization: null,
              organizationPayloads: [],
              groups: [],
            },
          });
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.getOrganizationPolicyHistoryResult(organizationId, "head", {
        beforeVersion: 34,
      }),
    ).toMatchObject({ ok: true, data: { beforeVersion: 34 } });
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(urls[0]);
    expect(new URL(urls[0] ?? "").searchParams.get("beforeVersion")).toBe("34");
  },
);
