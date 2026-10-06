import { expect } from "bun:test";
import {
  commitOrganizationGroupPolicyOperation,
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

for (const operation of [
  putPrincipalPolicyOperation,
  commitOrganizationGroupPolicyOperation,
]) {
  for (const scenario of [
    "rolled-back",
    "missing-marker",
    "committed",
    "other-code",
    "ordinary",
    "marker-only",
    "wrong-marker-type",
    "other-status",
    "expired-context",
  ] as const) {
    testApiClient(
      `${operation.id} preserves ${scenario} preparation outcome without retry`,
      async () => {
        let calls = 0;
        const messages: string[] = [];
        const runtime = new ApiRequestRuntime(apiBaseUrl);
        runtime.setOnError((message) => messages.push(message));
        server.use(
          http.put(`${apiBaseUrl}/principal`, () => {
            calls += 1;
            if (scenario === "expired-context")
              runtime.setAuthToken("renewed-token");
            return HttpResponse.json(
              {
                error: "Principal history preparation is busy; retry later",
                ...(scenario === "ordinary" || scenario === "marker-only"
                  ? {}
                  : {
                      code:
                        scenario === "other-code"
                          ? "unregistered_preparation_code"
                          : "principal_history_preparation_unavailable",
                    }),
                ...(scenario === "missing-marker" || scenario === "ordinary"
                  ? {}
                  : {
                      committed:
                        scenario === "wrong-marker-type"
                          ? "false"
                          : scenario === "committed",
                    }),
              },
              { status: scenario === "other-status" ? 500 : 503 },
            );
          }),
        );
        const result = await principalHistoryRequest(runtime, {
          path: "/principal",
          method: "PUT",
          body: "{}",
          operation,
          validator: (value): value is Record<string, unknown> =>
            typeof value === "object" && value !== null,
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected preparation refusal");
        expect(result.kind).toBe(
          scenario === "rolled-back" ? "http" : "outcome-unknown",
        );
        if (scenario === "rolled-back") {
          expect(result.code).toBe("principal_history_preparation_unavailable");
          expect(result.status).toBe(503);
        }
        expect(calls).toBe(1);
        expect(messages).toEqual(
          scenario === "expired-context" ? [] : [result.message],
        );
      },
    );
  }
}
