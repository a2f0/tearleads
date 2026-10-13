import { expect } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestMetrics } from "./apiRequestMetrics";

testApiClient(
  "counts actual HTTP attempts including renewal and retries",
  async () => {
    const metrics = new ApiRequestMetrics();
    const client = new ApiClient(apiBaseUrl, {
      metrics,
      getIdentity: () => "alice",
    });
    client.setAuthToken("old");
    let attempts = 0;
    server.use(
      http.get(`${apiBaseUrl}/auth/sessions`, () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json(
              { code: SESSION_ERROR_CODES.refreshRequired, error: "Expired" },
              { status: 401 },
            )
          : HttpResponse.json({ sessions: [] });
      }),
    );
    client.setOnSessionExpired(async () => {
      await client.listSessions();
      client.setAuthToken("new");
      return true;
    });
    expect(await client.listSessions()).toEqual({ sessions: [] });
    expect(attempts).toBe(3);
    expect(metrics.getSnapshot("alice")).toMatchObject({
      total: 3,
      succeeded: 2,
      failed: 1,
      inFlight: 0,
    });
  },
);

testApiClient(
  "coalesced reads count once and retain only the route template",
  async () => {
    const metrics = new ApiRequestMetrics();
    const client = new ApiClient(apiBaseUrl, {
      metrics,
      getIdentity: () => "alice",
    });
    server.use(
      http.get(`${apiBaseUrl}/auth/user-identity/:id`, () =>
        HttpResponse.json({ error: "Missing" }, { status: 404 }),
      ),
    );
    await Promise.all([
      client.getUserIdentity("11111111-1111-4111-8111-111111111111"),
      client.getUserIdentity("11111111-1111-4111-8111-111111111111"),
    ]);
    expect(metrics.getSnapshot("alice").total).toBe(1);
    expect(metrics.getSnapshot("alice").endpoints[0]?.path).toBe(
      "/auth/user-identity/{userId}",
    );
    expect(JSON.stringify(metrics.getSnapshot("alice"))).not.toContain(
      "11111111-1111-4111-8111-111111111111",
    );
  },
);
