import { expect } from "bun:test";
import { getPrincipalPolicyOperation } from "@tearleads/validators/operation";
import { http, passthrough } from "msw";
import {
  server as mockServer,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";

for (const outcome of ["timeout", "silent-timeout", "cancelled"] as const) {
  testApiClient(
    `principal GET ${outcome} reports its final classification once`,
    async () => {
      mockServer.use(
        http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()),
      );
      const controller = new AbortController();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch() {
          if (outcome === "cancelled") controller.abort();
          await Bun.sleep(200);
          return Response.json({});
        },
      });
      const runtime = new ApiRequestRuntime(server.url.origin);
      const errors: string[] = [];
      let networkErrors = 0;
      runtime.setOnError((message) => errors.push(message));
      runtime.setOnNetworkError(() => {
        networkErrors += 1;
      });
      try {
        const result = await principalHistoryRequest(runtime, {
          method: "GET",
          path: "/principal",
          requestTimeoutMs: 75,
          operation: getPrincipalPolicyOperation,
          validator: (value): value is object =>
            typeof value === "object" && value !== null,
          options: {
            signal: controller.signal,
            reportErrors: outcome !== "silent-timeout",
          },
        });
        expect(result).toMatchObject({
          ok: false,
          kind: outcome === "cancelled" ? "cancelled" : "network",
          code:
            outcome === "cancelled"
              ? "principal_history_context_changed"
              : "principal_history_request_timed_out",
        });
        expect(errors).toEqual(
          outcome === "timeout" ? ["Principal history request timed out"] : [],
        );
        expect(networkErrors).toBe(outcome === "cancelled" ? 0 : 1);
      } finally {
        await server.stop(true);
      }
    },
  );
}
