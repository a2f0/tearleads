import { expect } from "bun:test";
import {
  commitOrganizationGroupPolicyOperation,
  getPrincipalPolicyOperation,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";
import { HttpResponse, http } from "msw";
import { createPrincipalPolicyRequest } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";

for (const method of ["GET", "PUT"] as const) {
  for (const [failure, response] of [
    ["network", () => HttpResponse.error()],
    ["json", () => new HttpResponse("{")],
    ["shape", () => HttpResponse.json({})],
    [
      "server",
      () =>
        HttpResponse.json({ error: "Upstream response lost" }, { status: 502 }),
    ],
    [
      "preparation",
      () =>
        HttpResponse.json(
          { code: "principal_history_preparation_pending", committed: true },
          { status: 202 },
        ),
    ],
    [
      "refused",
      () => HttpResponse.json({ error: "Policy is stale" }, { status: 409 }),
    ],
  ] as const) {
    testApiClient(
      `${method} ${failure} failure preserves commit uncertainty without replay`,
      async () => {
        let calls = 0;
        server.use(
          http.all(`${apiBaseUrl}/principal`, () => {
            calls += 1;
            return response();
          }),
        );
        const result = await principalHistoryRequest(
          new ApiRequestRuntime(apiBaseUrl),
          {
            path: "/principal",
            method,
            operation:
              method === "GET"
                ? getPrincipalPolicyOperation
                : putPrincipalPolicyOperation,
            validator: (value): value is Record<string, unknown> =>
              typeof value === "object" && value !== null,
            options: { reportErrors: false },
          },
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected failure");
        expect(result.kind === "outcome-unknown").toBe(
          method === "PUT" && failure !== "refused",
        );
        expect(calls).toBe(1);
      },
    );
  }
}

for (const status of [200, 401, 408, 409, 499, 502]) {
  testApiClient(
    `compound write ${status} reports its final outcome exactly once`,
    async () => {
      const runtime = new ApiRequestRuntime(apiBaseUrl);
      const messages: string[] = [];
      runtime.setOnError((message) => messages.push(message));
      let calls = 0;
      server.use(
        http.put(`${apiBaseUrl}/principal`, () => {
          calls += 1;
          return HttpResponse.json({ error: "Test refusal" }, { status });
        }),
      );
      const result = await principalHistoryRequest(runtime, {
        path: "/principal",
        method: "PUT",
        operation: commitOrganizationGroupPolicyOperation,
        validator: (value): value is Record<string, unknown> =>
          typeof value === "object" && value !== null,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.kind).toBe(
        [200, 408, 499, 502].includes(status) ? "outcome-unknown" : "http",
      );
      expect(messages).toEqual([result.message]);
      expect(calls).toBe(1);
    },
  );
}

testApiClient(
  "the public organization write result preserves an unknown outcome",
  async () => {
    let calls = 0;
    server.use(
      http.put(`${apiBaseUrl}/principals/organization/:id/policy`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    const result = await client.putPrincipalPolicyResult(
      "organization",
      "11111111-1111-4111-8111-111111111111",
      createPrincipalPolicyRequest(),
      { reportErrors: false },
    );
    expect(result).toMatchObject({ ok: false, kind: "outcome-unknown" });
    expect(calls).toBe(1);
  },
);
