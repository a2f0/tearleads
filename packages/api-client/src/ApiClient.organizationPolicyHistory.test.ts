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
            organizationPayloads: [],
            groups: [],
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
