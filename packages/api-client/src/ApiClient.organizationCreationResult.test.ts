import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { createOrganizationRequestFixture } from "../test/helpers/provisioningFixtures";
import { ApiClient } from "./ApiClient";

const terminal = { code: "organization_creation_purged", error: "Purged" };

for (const [label, status, body, expectedCode] of [
  ["certified purge", 410, terminal, terminal.code],
  ["generic conflict", 409, { error: "Unavailable" }, undefined],
  ["unregistered code on conflict", 409, terminal, undefined],
  ["unregistered code on validation failure", 400, terminal, undefined],
  ["transient failure", 503, terminal, undefined],
  ["missing error", 410, { code: terminal.code }, undefined],
  ["missing code", 410, { error: "Purged" }, undefined],
  ["unknown code", 410, { ...terminal, code: "unknown" }, undefined],
  ["malformed error", 410, { ...terminal, error: null }, undefined],
] as const) {
  testApiClient(
    `create result accepts only a registered terminal response: ${label}`,
    async () => {
      server.use(
        http.post(`${apiBaseUrl}/organizations`, () =>
          HttpResponse.json(body, { status }),
        ),
      );
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("session-token");
      client.setOnError(() => {});
      const result = await client.createOrganizationResult(
        createOrganizationRequestFixture(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected refusal");
      expect(result.status).toBe(status);
      expect(result.code).toBe(expectedCode);
      expect(
        await client.createOrganization(createOrganizationRequestFixture()),
      ).toBeNull();
    },
  );
}

for (const failure of ["json", "network"] as const) {
  testApiClient(
    `create result preserves ambiguous ${failure} failure`,
    async () => {
      server.use(
        http.post(`${apiBaseUrl}/organizations`, () =>
          failure === "json"
            ? new HttpResponse("not-json", { status: 410 })
            : HttpResponse.error(),
        ),
      );
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("session-token");
      client.setOnError(() => {});
      const result = await client.createOrganizationResult(
        createOrganizationRequestFixture(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBeUndefined();
      expect(result.kind).toBe(failure === "network" ? "network" : "http");
    },
  );
}
