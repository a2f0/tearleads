import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createPrincipalPolicyBundleResponse,
  createPrincipalPolicyRequest,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const id = "11111111-1111-4111-8111-111111111111";
const path = `${apiBaseUrl}/principals/organization/:principalId/policy`;
const pending = (step: number) => ({
  code: "principal_history_preparation_pending",
  committed: false,
  progressToken: step.toString(16).padStart(64, "0"),
});

for (const method of ["GET", "PUT"] as const) {
  testApiClient(
    `${method} policy accepts cancellation without a network error`,
    async () => {
      const client = new ApiClient(apiBaseUrl);
      const controller = new AbortController();
      let failures = 0;
      let calls = 0;
      client.setOnNetworkError(() => {
        failures += 1;
      });
      client.setOnError(() => {
        failures += 1;
      });
      const handler = method === "GET" ? http.get : http.put;
      server.use(
        handler(path, () => {
          calls += 1;
          controller.abort();
          return HttpResponse.json(pending(1), { status: 202 });
        }),
      );
      const options = { signal: controller.signal };
      const result =
        method === "GET"
          ? await client.getCurrentPrincipalPolicy("organization", id, options)
          : await client.putPrincipalPolicy(
              "organization",
              id,
              createPrincipalPolicyRequest(),
              options,
            );
      expect(result).toBeNull();
      expect(calls).toBe(1);
      expect(failures).toBe(0);
    },
  );
}

testApiClient(
  "changing progress permits more rounds than the page budget",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    const bundle = createPrincipalPolicyBundleResponse();
    let calls = 0;
    server.use(
      http.get(path, () => {
        calls += 1;
        return calls <= 40
          ? HttpResponse.json(pending(calls), { status: 202 })
          : HttpResponse.json(bundle);
      }),
    );
    expect(await client.getCurrentPrincipalPolicy("organization", id)).toEqual(
      bundle,
    );
    expect(calls).toBe(41);
  },
);

testApiClient(
  "a stalled policy read releases its shared request for a new attempt",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    const bundle = createPrincipalPolicyBundleResponse();
    let calls = 0;
    server.use(
      http.get(path, () => {
        calls += 1;
        return calls <= 3
          ? HttpResponse.json(pending(1), { status: 202 })
          : HttpResponse.json(bundle);
      }),
    );
    expect(
      await client.getCurrentPrincipalPolicy("organization", id, {
        reportErrors: false,
      }),
    ).toBeNull();
    expect(await client.getCurrentPrincipalPolicy("organization", id)).toEqual(
      bundle,
    );
    expect(calls).toBe(4);
  },
);
