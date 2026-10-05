import { expect } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
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

testApiClient(
  "an expired policy read renews and restarts without failing its callers",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("expired-session");
    let renewals = 0;
    let calls = 0;
    let errors = 0;
    client.setOnError(() => {
      errors += 1;
    });
    client.setOnSessionExpired(() => {
      renewals += 1;
      client.setAuthToken("renewed-session");
      return true;
    });
    const bundle = createPrincipalPolicyBundleResponse();
    server.use(
      http.get(path, ({ request }) => {
        calls += 1;
        if (calls === 1)
          return HttpResponse.json(
            {
              code: SESSION_ERROR_CODES.refreshRequired,
              error: "Expired session",
            },
            { status: 401 },
          );
        expect(request.headers.get("Authorization")).toBe(
          "Bearer renewed-session",
        );
        return HttpResponse.json(bundle);
      }),
    );
    const results = await Promise.all([
      client.getCurrentPrincipalPolicy("organization", id),
      client.getCurrentPrincipalPolicy("organization", id),
    ]);
    expect(results).toEqual([bundle, bundle]);
    expect([calls, renewals, errors]).toEqual([2, 1, 0]);
  },
);

testApiClient(
  "aborting while reading a policy body does not report a network failure",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    const controller = new AbortController();
    let failures = 0;
    client.setOnError(() => {
      failures += 1;
    });
    client.setOnNetworkError(() => {
      failures += 1;
    });
    server.use(
      http.get(
        path,
        () =>
          new HttpResponse(
            new ReadableStream({
              start(stream) {
                stream.enqueue(new TextEncoder().encode("{"));
                setTimeout(() => {
                  controller.abort();
                  stream.error(
                    new DOMException("Request was aborted", "AbortError"),
                  );
                }, 10);
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    expect(
      await client.getCurrentPrincipalPolicy("organization", id, {
        signal: controller.signal,
      }),
    ).toBeNull();
    const failure = client.getRequestFailure({
      method: "GET",
      path: `/principals/organization/${id}/policy`,
    });
    failure?.report();
    expect(failures).toBe(0);
  },
);
