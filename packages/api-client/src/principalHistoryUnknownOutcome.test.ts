import { expect } from "bun:test";
import {
  getPrincipalPolicyOperation,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
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
